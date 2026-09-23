create type public.post_attachment_status as enum ('pending', 'ready', 'deleted');

create table public.post_attachments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  storage_bucket text not null default 'post-attachments',
  object_path text not null,
  original_filename text not null,
  position integer not null,
  mime_type text not null,
  size_bytes bigint not null,
  width integer,
  height integer,
  status public.post_attachment_status not null default 'pending',
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  deleted_at timestamptz,
  cleanup_lease_id uuid,
  cleanup_lease_expires_at timestamptz,
  constraint post_attachments_bucket_check check (storage_bucket = 'post-attachments'),
  constraint post_attachments_path_check check (
    object_path = post_id::text || '/' || id::text
  ),
  constraint post_attachments_filename_check check (
    char_length(btrim(original_filename)) between 1 and 255
  ),
  -- Negative values are used only inside the atomic reorder RPC.
  constraint post_attachments_position_check check (position between -10 and 9),
  constraint post_attachments_mime_check check (
    char_length(btrim(mime_type)) between 1 and 255
  ),
  constraint post_attachments_size_check check (size_bytes between 1 and 31457280),
  constraint post_attachments_dimensions_check check (
    (width is null and height is null)
    or (width between 1 and 100000 and height between 1 and 100000)
  ),
  constraint post_attachments_status_timestamps_check check (
    (status = 'pending' and ready_at is null and deleted_at is null)
    or (status = 'ready' and ready_at is not null and deleted_at is null)
    or (status = 'deleted' and deleted_at is not null)
  ),
  constraint post_attachments_cleanup_lease_check check (
    (cleanup_lease_id is null) = (cleanup_lease_expires_at is null)
  ),
  unique (storage_bucket, object_path)
);

create unique index post_attachments_active_position_idx
on public.post_attachments (post_id, position)
where status <> 'deleted';

create index post_attachments_post_list_idx
on public.post_attachments (post_id, position, id)
where status = 'ready';

create index post_attachments_cleanup_idx
on public.post_attachments (created_at, id)
where status in ('pending', 'deleted');

alter table public.post_attachments enable row level security;
revoke all on table public.post_attachments from anon, authenticated;
grant select on table public.post_attachments to authenticated;

-- This narrow helper lets attachment and Storage policies verify the private author row.
create function private.is_post_author(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from private.post_authors as author
      where author.post_id = p_post_id
        and author.profile_id = private.current_profile_id()
    );
$$;

revoke all on function private.is_post_author(uuid) from public;
grant execute on function private.is_post_author(uuid) to authenticated;

create policy "post_attachments_select_reader"
on public.post_attachments
for select
to authenticated
using (
  status <> 'deleted'
  and exists (
    select 1
    from public.posts as post
    where post.id = post_attachments.post_id
      and post.kind = 'group'
      and post.deleted_at is null
      and (
        private.is_post_author(post.id)
        or (
          status = 'ready'
          and post.published_at is not null
          and private.is_group_member(post.group_id)
        )
      )
  )
);

create policy "post_attachments_storage_insert_pending_author"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'post-attachments'
  and owner_id = (select auth.uid()::text)
  and exists (
    select 1
    from public.post_attachments as attachment
    join public.posts as post on post.id = attachment.post_id
    where attachment.storage_bucket = storage.objects.bucket_id
      and attachment.object_path = storage.objects.name
      and attachment.status = 'pending'
      and post.deleted_at is null
      and private.is_post_author(post.id)
  )
);

create policy "post_attachments_storage_select_reader"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'post-attachments'
  and storage.allow_any_operation(array[
    'object.get_authenticated_info',
    'object.get_authenticated'
  ])
  and exists (
    select 1
    from public.post_attachments as attachment
    join public.posts as post on post.id = attachment.post_id
    where attachment.storage_bucket = storage.objects.bucket_id
      and attachment.object_path = storage.objects.name
      and attachment.status = 'ready'
      and post.deleted_at is null
      and (
        (post.published_at is not null and private.is_group_member(post.group_id))
        or (post.published_at is null and private.is_post_author(post.id))
      )
  )
);

-- Draft publication is the sole permitted published_at transition.
create or replace function private.prevent_post_immutable_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.kind is distinct from old.kind
    or new.group_id is distinct from old.group_id
    or new.timeline_profile_id is distinct from old.timeline_profile_id
    or new.author_identity is distinct from old.author_identity
    or new.display_author_profile_id is distinct from old.display_author_profile_id
    or new.visibility is distinct from old.visibility
    or new.body_format_version is distinct from old.body_format_version
    or new.created_at is distinct from old.created_at
    or (
      new.published_at is distinct from old.published_at
      and not (
        current_setting('app.publish_group_post', true) = '1'
        and old.published_at is null
        and new.published_at is not null
      )
    ) then
    raise exception 'post identity and publication fields cannot be changed'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

alter table public.posts drop constraint posts_publication_timestamps;
alter table public.posts add constraint posts_publication_timestamps check (
  (published_at is null or published_at >= created_at)
  and (edited_at is null or (published_at is not null and edited_at >= published_at))
  and (deleted_at is null or published_at is null or deleted_at >= published_at)
  and (pinned_at is null or (published_at is not null and pinned_at >= published_at))
);

drop policy "posts_select_group_member" on public.posts;
create policy "posts_select_group_member_or_draft_author"
on public.posts
for select
to authenticated
using (
  kind = 'group'
  and deleted_at is null
  and (
    (published_at is not null and private.is_group_member(group_id))
    or (published_at is null and private.is_post_author(id))
  )
);

drop function public.create_group_post(uuid, text, text, public.post_identity, uuid);

create function public.create_group_post(
  p_group_id uuid,
  p_title text,
  p_body text,
  p_author_identity public.post_identity,
  p_category_id uuid default null,
  p_publish boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  group_record public.groups;
  member_role public.group_member_role;
  created_post_id uuid;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select group_data.*
  into group_record
  from public.groups as group_data
  join public.group_memberships as membership
    on membership.group_id = group_data.id
    and membership.profile_id = caller_profile_id
  where group_data.id = p_group_id;

  select membership.role
  into member_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = caller_profile_id;

  if group_record.id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  if group_record.posting_policy = 'staff'
    and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'group posting is restricted to staff' using errcode = '42501';
  end if;
  if p_author_identity = 'identified'
    and group_record.identity_policy = 'always_anonymous' then
    raise exception 'identified posting is not allowed' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous'
    and group_record.identity_policy = 'identified' then
    raise exception 'anonymous posting is not allowed' using errcode = '42501';
  end if;
  if p_author_identity = 'staff'
    and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'staff identity is not allowed' using errcode = '42501';
  end if;
  if nullif(btrim(p_title), '') is null or char_length(btrim(p_title)) > 100 then
    raise exception 'title must contain between 1 and 100 characters' using errcode = '22023';
  end if;
  if char_length(coalesce(p_body, '')) > 20000 then
    raise exception 'body must contain between 0 and 20000 characters' using errcode = '22023';
  end if;
  if coalesce(p_publish, true) and nullif(btrim(coalesce(p_body, '')), '') is null then
    raise exception 'published post requires a body or ready attachment' using errcode = '22023';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.group_categories as category
    where category.id = p_category_id and category.group_id = p_group_id
  ) then
    raise exception 'category must belong to the group' using errcode = '22023';
  end if;

  insert into public.posts (
    kind, body, group_id, title, category_id, author_identity,
    display_author_profile_id, published_at
  ) values (
    'group', coalesce(p_body, ''), p_group_id, btrim(p_title), p_category_id,
    p_author_identity,
    case when p_author_identity = 'identified' then caller_profile_id end,
    case when coalesce(p_publish, true) then now() end
  ) returning id into created_post_id;

  insert into private.post_authors (post_id, profile_id)
  values (created_post_id, caller_profile_id);

  return created_post_id;
end;
$$;

revoke all on function public.create_group_post(uuid, text, text, public.post_identity, uuid, boolean) from public;
grant execute on function public.create_group_post(uuid, text, text, public.post_identity, uuid, boolean) to authenticated;

create function public.publish_group_post(p_post_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  post_record public.posts;
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group' and post.deleted_at is null
  for update;

  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can publish this post' using errcode = '42501';
  end if;
  if post_record.published_at is not null then
    return p_post_id;
  end if;
  if exists (
    select 1 from public.post_attachments
    where post_id = p_post_id and status = 'pending'
  ) then
    raise exception 'pending attachments must be finalized or deleted' using errcode = '55000';
  end if;
  if nullif(btrim(post_record.body), '') is null and not exists (
    select 1 from public.post_attachments
    where post_id = p_post_id and status = 'ready'
  ) then
    raise exception 'published post requires a body or ready attachment' using errcode = '22023';
  end if;

  perform set_config('app.publish_group_post', '1', true);
  update public.posts set published_at = now() where id = p_post_id;
  return p_post_id;
end;
$$;

revoke all on function public.publish_group_post(uuid) from public;
grant execute on function public.publish_group_post(uuid) to authenticated;

create function public.prepare_post_attachment(
  p_post_id uuid,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_width integer default null,
  p_height integer default null
)
returns public.post_attachments
language plpgsql
security definer
set search_path = ''
as $$
declare
  post_record public.posts;
  attachment public.post_attachments;
  attachment_id uuid := gen_random_uuid();
  next_position integer;
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record from public.posts as post
  where post.id = p_post_id and post.kind = 'group' and post.deleted_at is null
  for update;
  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can add attachments' using errcode = '42501';
  end if;
  if (select count(*) from public.post_attachments
      where post_id = p_post_id and status <> 'deleted') >= 10 then
    raise exception 'a post can have at most 10 attachments' using errcode = '23514';
  end if;

  select coalesce(min(candidate), 0) into next_position
  from generate_series(0, 9) as candidate
  where not exists (
    select 1 from public.post_attachments
    where post_id = p_post_id and status <> 'deleted' and position = candidate
  );

  insert into public.post_attachments (
    id, post_id, object_path, original_filename, position, mime_type,
    size_bytes, width, height
  ) values (
    attachment_id, p_post_id, p_post_id::text || '/' || attachment_id::text,
    btrim(p_original_filename), next_position, btrim(p_mime_type),
    p_size_bytes, p_width, p_height
  ) returning * into attachment;
  return attachment;
end;
$$;

create function public.finalize_post_attachment(p_attachment_id uuid)
returns public.post_attachments
language plpgsql
security definer
set search_path = ''
as $$
declare
  attachment public.post_attachments;
  object_record storage.objects;
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select item.* into attachment from public.post_attachments as item
  where item.id = p_attachment_id for update;
  if attachment.id is null or not private.is_post_author(attachment.post_id) then
    raise exception 'only the author can finalize attachments' using errcode = '42501';
  end if;
  if attachment.status <> 'pending' then
    raise exception 'attachment is not pending' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.posts
    where id = attachment.post_id and deleted_at is null
  ) then
    raise exception 'post is deleted' using errcode = '55000';
  end if;

  select object.* into object_record
  from storage.objects as object
  where object.bucket_id = attachment.storage_bucket
    and object.name = attachment.object_path;

  if object_record.id is null then
    raise exception 'uploaded object not found' using errcode = 'P0002';
  end if;
  if object_record.owner_id is distinct from auth.uid()::text then
    raise exception 'uploaded object owner does not match' using errcode = '42501';
  end if;
  if nullif(object_record.metadata ->> 'size', '')::bigint is distinct from attachment.size_bytes then
    raise exception 'uploaded object size does not match' using errcode = '22023';
  end if;
  if object_record.metadata ->> 'mimetype' is distinct from attachment.mime_type then
    raise exception 'uploaded object MIME type does not match' using errcode = '22023';
  end if;

  update public.post_attachments
  set status = 'ready', ready_at = now()
  where id = p_attachment_id
  returning * into attachment;
  return attachment;
end;
$$;

create function public.reorder_post_attachments(p_post_id uuid, p_attachment_ids uuid[])
returns setof public.post_attachments
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_count integer;
begin
  perform 1 from public.posts where id = p_post_id and deleted_at is null for update;
  if not found or not private.is_post_author(p_post_id) then
    raise exception 'only the author can reorder attachments' using errcode = '42501';
  end if;
  if p_attachment_ids is null
    or cardinality(p_attachment_ids) > 10
    or cardinality(p_attachment_ids) <> (
      select count(distinct id) from unnest(p_attachment_ids) as id
    ) then
    raise exception 'attachment order must contain unique ids' using errcode = '22023';
  end if;
  select count(*) into active_count from public.post_attachments
  where post_id = p_post_id and status <> 'deleted';
  if cardinality(p_attachment_ids) <> active_count
    or exists (
      select 1 from unnest(p_attachment_ids) as requested(id)
      where not exists (
        select 1 from public.post_attachments as item
        where item.id = requested.id and item.post_id = p_post_id and item.status <> 'deleted'
      )
    ) then
    raise exception 'attachment order must contain every active attachment exactly once'
      using errcode = '22023';
  end if;

  -- Move to a disjoint range first so the partial unique index stays valid.
  update public.post_attachments set position = -position - 1
  where post_id = p_post_id and status <> 'deleted';
  update public.post_attachments as item
  set position = requested.ordinality - 1
  from unnest(p_attachment_ids) with ordinality as requested(id, ordinality)
  where item.id = requested.id;

  return query select item.* from public.post_attachments as item
  where item.post_id = p_post_id and item.status <> 'deleted'
  order by item.position, item.id;
end;
$$;

create function public.delete_post_attachment(p_attachment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  attachment public.post_attachments;
begin
  select item.* into attachment from public.post_attachments as item
  where item.id = p_attachment_id for update;
  if attachment.id is null or not private.is_post_author(attachment.post_id) then
    raise exception 'only the author can delete attachments' using errcode = '42501';
  end if;
  if attachment.status = 'ready'
    and exists (
      select 1 from public.posts
      where id = attachment.post_id
        and published_at is not null
        and nullif(btrim(body), '') is null
    )
    and not exists (
      select 1 from public.post_attachments
      where post_id = attachment.post_id
        and id <> attachment.id
        and status = 'ready'
    ) then
    raise exception 'post requires a body or ready attachment' using errcode = '22023';
  end if;
  if attachment.status <> 'deleted' then
    update public.post_attachments
    set status = 'deleted', deleted_at = now(), cleanup_lease_id = null,
      cleanup_lease_expires_at = null
    where id = p_attachment_id;
  end if;
end;
$$;

create function public.list_post_attachments(p_post_id uuid)
returns table (
  attachment_id uuid,
  post_id uuid,
  storage_bucket text,
  object_path text,
  original_filename text,
  "position" integer,
  mime_type text,
  size_bytes bigint,
  width integer,
  height integer,
  status public.post_attachment_status,
  created_at timestamptz,
  ready_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select item.id, item.post_id, item.storage_bucket, item.object_path,
    item.original_filename, item.position, item.mime_type, item.size_bytes,
    item.width, item.height, item.status, item.created_at, item.ready_at
  from public.post_attachments as item
  where item.post_id = p_post_id
    and item.status <> 'deleted'
    and (
      item.status = 'ready'
      or private.is_post_author(item.post_id)
    )
  order by item.position, item.id;
$$;

revoke all on function public.prepare_post_attachment(uuid, text, text, bigint, integer, integer) from public;
revoke all on function public.finalize_post_attachment(uuid) from public;
revoke all on function public.reorder_post_attachments(uuid, uuid[]) from public;
revoke all on function public.delete_post_attachment(uuid) from public;
revoke all on function public.list_post_attachments(uuid) from public;
grant execute on function public.prepare_post_attachment(uuid, text, text, bigint, integer, integer) to authenticated;
grant execute on function public.finalize_post_attachment(uuid) to authenticated;
grant execute on function public.reorder_post_attachments(uuid, uuid[]) to authenticated;
grant execute on function public.delete_post_attachment(uuid) to authenticated;
grant execute on function public.list_post_attachments(uuid) to authenticated;

create function private.claim_post_attachment_cleanup(
  p_limit integer default 100,
  p_lease_seconds integer default 300
)
returns table (
  attachment_id uuid,
  storage_bucket text,
  object_path text,
  lease_id uuid
)
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
    select item.id
    from public.post_attachments as item
    where (
        (item.status = 'pending' and item.created_at <= now() - interval '48 hours')
        or item.status = 'deleted'
      )
      and (
        item.cleanup_lease_expires_at is null
        or item.cleanup_lease_expires_at <= now()
      )
    order by item.created_at, item.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.post_attachments as item
    set cleanup_lease_id = gen_random_uuid(),
      cleanup_lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    from candidates
    where item.id = candidates.id
    returning item.id, item.storage_bucket, item.object_path, item.cleanup_lease_id
  )
  select claimed.id, claimed.storage_bucket, claimed.object_path, claimed.cleanup_lease_id
  from claimed;
end;
$$;

create function private.complete_post_attachment_cleanup(
  p_attachment_id uuid,
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
    delete from public.post_attachments
    where id = p_attachment_id
      and cleanup_lease_id = p_lease_id
      and cleanup_lease_expires_at > now()
      and (
        status = 'deleted'
        or (status = 'pending' and created_at <= now() - interval '48 hours')
      );
  else
    update public.post_attachments
    set cleanup_lease_id = null, cleanup_lease_expires_at = null
    where id = p_attachment_id and cleanup_lease_id = p_lease_id;
  end if;
  return found;
end;
$$;

revoke all on function private.claim_post_attachment_cleanup(integer, integer) from public;
revoke all on function private.complete_post_attachment_cleanup(uuid, uuid, boolean) from public;
grant usage on schema private to service_role;
grant execute on function private.claim_post_attachment_cleanup(integer, integer) to service_role;
grant execute on function private.complete_post_attachment_cleanup(uuid, uuid, boolean) to service_role;

-- Keep post deletion transactional with attachment metadata tombstoning. Object deletion is deferred.
create or replace function public.delete_group_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
  caller_role public.group_member_role;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record from public.posts as post
  where post.id = p_post_id and post.kind = 'group' and post.deleted_at is null
  for update;
  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = post_record.group_id
    and membership.profile_id = caller_profile_id;
  if post_record.id is null or caller_role is null then
    raise exception 'post not found or not accessible' using errcode = '42501';
  end if;
  if caller_role not in ('owner', 'admin') and not private.is_post_author(p_post_id) then
    raise exception 'post deletion is not allowed' using errcode = '42501';
  end if;
  update public.posts set deleted_at = now(), pinned_at = null where id = p_post_id;
  update public.post_attachments
  set status = 'deleted', deleted_at = now(), cleanup_lease_id = null,
    cleanup_lease_expires_at = null
  where post_id = p_post_id and status <> 'deleted';
end;
$$;

-- A blank body is valid only while a ready attachment remains.
create or replace function public.update_group_post(
  p_post_id uuid,
  p_title text,
  p_body text,
  p_category_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record from public.posts as post
  where post.id = p_post_id and post.kind = 'group' and post.deleted_at is null
  for update;
  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can update this post' using errcode = '42501';
  end if;
  if not private.is_group_member(post_record.group_id) then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  if nullif(btrim(p_title), '') is null or char_length(btrim(p_title)) > 100 then
    raise exception 'title must contain between 1 and 100 characters' using errcode = '22023';
  end if;
  if char_length(coalesce(p_body, '')) > 20000 then
    raise exception 'body must contain between 0 and 20000 characters' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null and not exists (
    select 1 from public.post_attachments
    where post_id = p_post_id and status = 'ready'
  ) then
    raise exception 'post requires a body or ready attachment' using errcode = '22023';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.group_categories as category
    where category.id = p_category_id and category.group_id = post_record.group_id
  ) then
    raise exception 'category must belong to the group' using errcode = '22023';
  end if;

  update public.posts
  set title = btrim(p_title), body = coalesce(p_body, ''), category_id = p_category_id,
    edited_at = case when published_at is not null then now() else null end
  where id = p_post_id;
  return p_post_id;
end;
$$;
