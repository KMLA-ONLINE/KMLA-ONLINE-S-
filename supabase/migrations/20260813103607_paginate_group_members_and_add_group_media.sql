drop function public.list_group_members(uuid, text);

-- Keep bucket security limits reproducible even when the local Storage API is
-- temporarily unavailable while `supabase db reset` synchronizes config.toml.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('post-attachments', 'post-attachments', false, 31457280, null),
  ('group-media', 'group-media', false, 4194304, array['image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function public.list_group_members(
  p_group_id uuid,
  p_query text default '',
  p_after_role public.group_member_role default null,
  p_after_joined_at timestamptz default null,
  p_after_membership_id uuid default null,
  p_limit integer default 30
)
returns table (
  membership_id uuid,
  pub_id text,
  name text,
  cohort smallint,
  avatar_path text,
  role public.group_member_role,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  group_identity_policy public.group_identity_policy;
  query_text text := btrim(coalesce(p_query, ''));
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'member page limit must be between 1 and 100' using errcode = '22023';
  end if;
  if (p_after_role is null) <> (p_after_joined_at is null)
    or (p_after_role is null) <> (p_after_membership_id is null) then
    raise exception 'member cursor must be complete' using errcode = '22023';
  end if;

  select group_record.identity_policy
  into group_identity_policy
  from public.groups as group_record
  join public.group_memberships as caller_membership
    on caller_membership.group_id = group_record.id
    and caller_membership.profile_id = caller_profile_id
  where group_record.id = p_group_id;

  if group_identity_policy is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  return query
  select
    membership.id,
    case when group_identity_policy = 'always_anonymous' then null else profile.pub_id end,
    case when group_identity_policy = 'always_anonymous' then null else profile.name end,
    profile.cohort,
    case when group_identity_policy = 'always_anonymous' then null else profile.avatar_path end,
    membership.role,
    membership.joined_at
  from public.group_memberships as membership
  join public.profiles as profile on profile.id = membership.profile_id
  where membership.group_id = p_group_id
    and (
      query_text = ''
      or profile.cohort::text like '%' || query_text || '%'
      or (
        group_identity_policy <> 'always_anonymous'
        and profile.name ilike '%' || query_text || '%'
      )
    )
    and (
      p_after_role is null
      or (membership.role, membership.joined_at, membership.id)
        > (p_after_role, p_after_joined_at, p_after_membership_id)
    )
  order by membership.role, membership.joined_at, membership.id
  limit p_limit;
end;
$$;

revoke all on function public.list_group_members(
  uuid, text, public.group_member_role, timestamptz, uuid, integer
) from public, anon;
grant execute on function public.list_group_members(
  uuid, text, public.group_member_role, timestamptz, uuid, integer
) to authenticated;

create type public.group_media_slot as enum ('icon', 'cover');
create type public.group_media_status as enum ('pending', 'ready', 'deleted');

create table public.group_media_objects (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  slot public.group_media_slot not null,
  object_path text not null unique,
  size_bytes bigint not null,
  width integer not null,
  height integer not null,
  status public.group_media_status not null default 'pending',
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  deleted_at timestamptz,
  cleanup_lease_id uuid,
  cleanup_lease_expires_at timestamptz,
  constraint group_media_path_check check (
    object_path = group_id::text || '/' || slot::text || '/' || id::text
  ),
  constraint group_media_size_check check (
    size_bytes between 1 and case slot when 'icon' then 1048576 else 4194304 end
  ),
  constraint group_media_dimensions_check check (
    (slot = 'icon' and width = height and width between 1 and 512)
    or (slot = 'cover' and width = height * 4 and width between 4 and 2400)
  ),
  constraint group_media_status_timestamps_check check (
    (status = 'pending' and ready_at is null and deleted_at is null)
    or (status = 'ready' and ready_at is not null and deleted_at is null)
    or (status = 'deleted' and deleted_at is not null)
  ),
  constraint group_media_cleanup_lease_check check (
    (cleanup_lease_id is null) = (cleanup_lease_expires_at is null)
  )
);

create index group_media_cleanup_idx
on public.group_media_objects (created_at, id)
where status in ('pending', 'deleted');

alter table public.group_media_objects enable row level security;
revoke all on table public.group_media_objects from anon, authenticated;

-- Browser roles never read media metadata directly; all access is through the
-- narrow RPC and Storage-policy helpers below.
create policy "group_media_objects_no_direct_browser_read"
on public.group_media_objects
for select
to authenticated
using (false);

create function private.can_manage_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = p_group_id
      and membership.profile_id = private.current_profile_id()
      and membership.role in ('owner', 'admin')
  );
$$;

revoke all on function private.can_manage_group(uuid) from public;
grant execute on function private.can_manage_group(uuid) to authenticated;

create function private.can_upload_group_media(p_object_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_media_objects as media
    where media.object_path = p_object_path
      and media.status = 'pending'
      and private.can_manage_group(media.group_id)
  );
$$;

create function private.can_read_group_media(p_object_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.groups as group_record
    where p_object_path in (group_record.icon_path, group_record.cover_path)
  );
$$;

revoke all on function private.can_upload_group_media(text) from public;
revoke all on function private.can_read_group_media(text) from public;
grant execute on function private.can_upload_group_media(text) to authenticated;
grant execute on function private.can_read_group_media(text) to authenticated;

create policy "group_media_storage_insert_pending_manager"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'group-media'
  and owner_id = (select auth.uid()::text)
  and private.can_upload_group_media(storage.objects.name)
);

create policy "group_media_storage_select_visible"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'group-media'
  and storage.allow_any_operation(array[
    'object.get_authenticated_info',
    'object.get_authenticated',
    'object.sign',
    'object.sign_many'
  ])
  and private.can_read_group_media(storage.objects.name)
);

create function public.prepare_group_media(
  p_group_id uuid,
  p_slot public.group_media_slot,
  p_size_bytes bigint,
  p_width integer,
  p_height integer
)
returns table (media_id uuid, object_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_id uuid := gen_random_uuid();
begin
  if not private.can_manage_group(p_group_id) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  insert into public.group_media_objects (
    id, group_id, slot, object_path, size_bytes, width, height
  ) values (
    created_id,
    p_group_id,
    p_slot,
    p_group_id::text || '/' || p_slot::text || '/' || created_id::text,
    p_size_bytes,
    p_width,
    p_height
  );

  return query select created_id,
    p_group_id::text || '/' || p_slot::text || '/' || created_id::text;
end;
$$;

create function public.finalize_group_media(p_media_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  media public.group_media_objects;
  object_record storage.objects;
  previous_path text;
begin
  select item.* into media
  from public.group_media_objects as item
  where item.id = p_media_id
  for update;

  if media.id is null or not private.can_manage_group(media.group_id) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;
  if media.status <> 'pending' then
    raise exception 'group media is not pending' using errcode = '55000';
  end if;

  select object.* into object_record
  from storage.objects as object
  where object.bucket_id = 'group-media'
    and object.name = media.object_path;

  if object_record.id is null then
    raise exception 'uploaded object not found' using errcode = 'P0002';
  end if;
  if object_record.owner_id is distinct from auth.uid()::text then
    raise exception 'uploaded object owner does not match' using errcode = '42501';
  end if;
  if nullif(object_record.metadata ->> 'size', '')::bigint is distinct from media.size_bytes
    or object_record.metadata ->> 'mimetype' is distinct from 'image/webp' then
    raise exception 'uploaded object metadata does not match' using errcode = '22023';
  end if;

  if media.slot = 'icon' then
    select icon_path into previous_path from public.groups where id = media.group_id for update;
    update public.groups set icon_path = media.object_path where id = media.group_id;
  else
    select cover_path into previous_path from public.groups where id = media.group_id for update;
    update public.groups set cover_path = media.object_path where id = media.group_id;
  end if;

  update public.group_media_objects
  set status = 'ready', ready_at = now()
  where id = media.id;

  if previous_path is not null and previous_path <> media.object_path then
    update public.group_media_objects
    set status = 'deleted', deleted_at = now()
    where object_path = previous_path and status = 'ready';
  end if;

  return media.object_path;
end;
$$;

create function public.remove_group_media(
  p_group_id uuid,
  p_slot public.group_media_slot
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_path text;
begin
  if not private.can_manage_group(p_group_id) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  if p_slot = 'icon' then
    select icon_path into previous_path from public.groups where id = p_group_id for update;
    update public.groups set icon_path = null where id = p_group_id;
  else
    select cover_path into previous_path from public.groups where id = p_group_id for update;
    update public.groups set cover_path = null where id = p_group_id;
  end if;

  if previous_path is not null then
    update public.group_media_objects
    set status = 'deleted', deleted_at = now()
    where object_path = previous_path and status = 'ready';
  end if;
end;
$$;

create function private.claim_group_media_cleanup(
  p_limit integer default 100,
  p_lease_seconds integer default 300
)
returns table (media_id uuid, object_path text, lease_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit not between 1 and 500 or p_lease_seconds not between 30 and 3600 then
    raise exception 'invalid cleanup lease parameters' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select media.id
    from public.group_media_objects as media
    where (
        (media.status = 'pending' and media.created_at <= now() - interval '48 hours')
        or media.status = 'deleted'
      )
      and (media.cleanup_lease_expires_at is null or media.cleanup_lease_expires_at <= now())
    order by media.created_at, media.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.group_media_objects as media
    set cleanup_lease_id = gen_random_uuid(),
      cleanup_lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    from candidates
    where media.id = candidates.id
    returning media.id, media.object_path, media.cleanup_lease_id
  )
  select claimed.id, claimed.object_path, claimed.cleanup_lease_id from claimed;
end;
$$;

create function private.complete_group_media_cleanup(
  p_media_id uuid,
  p_lease_id uuid,
  p_object_deleted boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_object_deleted, false) then
    delete from public.group_media_objects
    where id = p_media_id
      and cleanup_lease_id = p_lease_id
      and cleanup_lease_expires_at > now()
      and (status = 'deleted' or (status = 'pending' and created_at <= now() - interval '48 hours'));
  else
    update public.group_media_objects
    set cleanup_lease_id = null, cleanup_lease_expires_at = null
    where id = p_media_id and cleanup_lease_id = p_lease_id;
  end if;
  return found;
end;
$$;

revoke all on function public.prepare_group_media(uuid, public.group_media_slot, bigint, integer, integer) from public, anon;
revoke all on function public.finalize_group_media(uuid) from public, anon;
revoke all on function public.remove_group_media(uuid, public.group_media_slot) from public, anon;
grant execute on function public.prepare_group_media(uuid, public.group_media_slot, bigint, integer, integer) to authenticated;
grant execute on function public.finalize_group_media(uuid) to authenticated;
grant execute on function public.remove_group_media(uuid, public.group_media_slot) to authenticated;

revoke all on function private.claim_group_media_cleanup(integer, integer) from public;
revoke all on function private.complete_group_media_cleanup(uuid, uuid, boolean) from public;
grant usage on schema private to service_role;
grant execute on function private.claim_group_media_cleanup(integer, integer) to service_role;
grant execute on function private.complete_group_media_cleanup(uuid, uuid, boolean) to service_role;
