create type public.comment_image_status as enum (
  'pending',
  'finalized',
  'ready',
  'deleted'
);

create table public.comment_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  comment_id uuid references public.post_comments (id) on delete cascade,
  storage_bucket text not null default 'post-attachments',
  object_path text not null,
  mime_type text not null,
  size_bytes bigint not null,
  width integer not null,
  height integer not null,
  status public.comment_image_status not null default 'pending',
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  ready_at timestamptz,
  deleted_at timestamptz,
  cleanup_lease_id uuid,
  cleanup_lease_expires_at timestamptz,
  constraint comment_images_bucket_check check (storage_bucket = 'post-attachments'),
  constraint comment_images_path_check check (
    object_path = 'comments/' || post_id::text || '/' || id::text
  ),
  constraint comment_images_mime_check check (mime_type = 'image/webp'),
  constraint comment_images_size_check check (size_bytes between 1 and 8388608),
  constraint comment_images_dimensions_check check (
    width between 1 and 3072
    and height between 1 and 3072
    and greatest(width, height) <= 3072
  ),
  constraint comment_images_status_timestamps_check check (
    (status = 'pending' and comment_id is null and finalized_at is null
      and ready_at is null and deleted_at is null)
    or (status = 'finalized' and comment_id is null and finalized_at is not null
      and ready_at is null and deleted_at is null)
    or (status = 'ready' and comment_id is not null and finalized_at is not null
      and ready_at is not null and deleted_at is null)
    or (status = 'deleted' and deleted_at is not null)
  ),
  constraint comment_images_cleanup_lease_check check (
    (cleanup_lease_id is null) = (cleanup_lease_expires_at is null)
  ),
  unique (storage_bucket, object_path)
);

create unique index comment_images_ready_comment_idx
on public.comment_images (comment_id)
where status = 'ready';

create index comment_images_post_idx
on public.comment_images (post_id, comment_id)
where status = 'ready';

create index comment_images_cleanup_idx
on public.comment_images (created_at, id)
where status in ('pending', 'finalized', 'deleted');

alter table public.comment_images enable row level security;
revoke all on table public.comment_images from public, anon, authenticated;

create policy "comment_images_deny_client_access"
on public.comment_images
for all
to public
using (false)
with check (false);

create table private.comment_image_uploaders (
  image_id uuid primary key references public.comment_images (id) on delete cascade,
  profile_id bigint not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index comment_image_uploaders_profile_idx
on private.comment_image_uploaders (profile_id, image_id);

alter table private.comment_image_uploaders enable row level security;
revoke all on table private.comment_image_uploaders from public, anon, authenticated;

create policy "comment_image_uploaders_deny_client_access"
on private.comment_image_uploaders
for all
to public
using (false)
with check (false);

create function private.is_comment_image_uploader(p_image_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from private.comment_image_uploaders as uploader
      where uploader.image_id = p_image_id
        and uploader.profile_id = private.current_profile_id()
    );
$$;

revoke all on function private.is_comment_image_uploader(uuid) from public, anon;
grant execute on function private.is_comment_image_uploader(uuid) to authenticated;

create function public.prepare_comment_image(
  p_post_id uuid,
  p_mime_type text,
  p_size_bytes bigint,
  p_width integer,
  p_height integer
)
returns public.comment_images
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  context record;
  image_id uuid := gen_random_uuid();
  image public.comment_images;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  context := private.comment_post_context(p_post_id, caller_profile_id);
  if context.post_kind is null then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  if not context.is_visible then
    raise exception 'post is not accessible' using errcode = '42501';
  end if;
  if p_mime_type is distinct from 'image/webp'
    or p_size_bytes not between 1 and 8388608
    or coalesce(p_width between 1 and 3072, false) is false
    or coalesce(p_height between 1 and 3072, false) is false
    or coalesce(greatest(p_width, p_height) <= 3072, false) is false then
    raise exception 'invalid normalized comment image metadata' using errcode = '22023';
  end if;

  insert into public.comment_images (
    id, post_id, object_path, mime_type, size_bytes, width, height
  ) values (
    image_id, p_post_id, 'comments/' || p_post_id::text || '/' || image_id::text,
    p_mime_type, p_size_bytes, p_width, p_height
  ) returning * into image;

  insert into private.comment_image_uploaders (image_id, profile_id)
  values (image_id, caller_profile_id);

  return image;
end;
$$;

create function public.finalize_comment_image(p_image_id uuid)
returns public.comment_images
language plpgsql
security definer
set search_path = ''
as $$
declare
  image public.comment_images;
  object_record storage.objects;
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select item.* into image
  from public.comment_images as item
  where item.id = p_image_id
  for update;
  if image.id is null or not private.is_comment_image_uploader(p_image_id) then
    raise exception 'only the uploader can finalize a comment image' using errcode = '42501';
  end if;
  if image.status <> 'pending' then
    raise exception 'comment image is not pending' using errcode = '55000';
  end if;
  if not private.can_read_post(image.post_id) then
    raise exception 'post is not accessible' using errcode = '42501';
  end if;

  select object.* into object_record
  from storage.objects as object
  where object.bucket_id = image.storage_bucket
    and object.name = image.object_path;
  if object_record.id is null then
    raise exception 'uploaded object not found' using errcode = 'P0002';
  end if;
  if object_record.owner_id is distinct from auth.uid()::text then
    raise exception 'uploaded object owner does not match' using errcode = '42501';
  end if;
  if nullif(object_record.metadata ->> 'size', '')::bigint is distinct from image.size_bytes
    or object_record.metadata ->> 'mimetype' is distinct from image.mime_type then
    raise exception 'uploaded object metadata does not match' using errcode = '22023';
  end if;

  update public.comment_images
  set status = 'finalized', finalized_at = now()
  where id = p_image_id
  returning * into image;
  return image;
end;
$$;

create function private.can_upload_comment_image_object(
  p_storage_bucket text,
  p_object_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.comment_images as image
    where image.storage_bucket = p_storage_bucket
      and image.object_path = p_object_path
      and image.status = 'pending'
      and private.is_comment_image_uploader(image.id)
      and private.can_read_post(image.post_id)
  );
$$;

create function private.can_read_comment_image_object(
  p_storage_bucket text,
  p_object_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.comment_images as image
    join public.post_comments as comment on comment.id = image.comment_id
    where image.storage_bucket = p_storage_bucket
      and image.object_path = p_object_path
      and image.status = 'ready'
      and comment.deleted_at is null
      and private.can_read_post(image.post_id)
  );
$$;

revoke all on function private.can_upload_comment_image_object(text, text)
  from public, anon;
revoke all on function private.can_read_comment_image_object(text, text)
  from public, anon;
grant execute on function private.can_upload_comment_image_object(text, text)
  to authenticated;
grant execute on function private.can_read_comment_image_object(text, text)
  to authenticated;

create policy "comment_images_storage_insert_uploader"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'post-attachments'
  and owner_id = (select auth.uid()::text)
  and private.can_upload_comment_image_object(bucket_id, name)
);

create policy "comment_images_storage_select_reader"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'post-attachments'
  and storage.allow_any_operation(array[
    'object.get_authenticated_info',
    'object.get_authenticated',
    'object.sign',
    'object.sign_many'
  ])
  and private.can_read_comment_image_object(bucket_id, name)
);

create function public.list_comment_images(p_comment_ids uuid[])
returns table (
  image_id uuid,
  comment_id uuid,
  post_id uuid,
  storage_bucket text,
  object_path text,
  mime_type text,
  size_bytes bigint,
  width integer,
  height integer,
  ready_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_comment_ids is null or cardinality(p_comment_ids) > 500 then
    raise exception 'invalid comment image batch' using errcode = '22023';
  end if;

  return query
  select image.id, image.comment_id, image.post_id, image.storage_bucket,
    image.object_path, image.mime_type, image.size_bytes, image.width,
    image.height, image.ready_at
  from public.comment_images as image
  join public.post_comments as comment on comment.id = image.comment_id
  where image.comment_id = any(p_comment_ids)
    and image.status = 'ready'
    and comment.deleted_at is null
    and private.can_read_post(image.post_id)
  order by image.comment_id, image.id;
end;
$$;

-- Comment bodies may be empty only when the transactional RPC attaches a ready image.
alter table public.post_comments drop constraint post_comments_body_length;
alter table public.post_comments add constraint post_comments_body_length check (
  char_length(btrim(body)) between 0 and 5000
);

drop function public.create_post_comment(uuid, text, public.post_identity, uuid);

create function public.create_post_comment(
  p_post_id uuid,
  p_body text,
  p_author_identity public.post_identity,
  p_parent_comment_id uuid default null,
  p_image_id uuid default null
)
returns table (
  comment_id uuid, post_id uuid, parent_comment_id uuid, root_comment_id uuid,
  depth smallint, body text, author_identity public.post_identity,
  author_pub_id text, author_name text, author_avatar_path text, author_label text,
  created_at timestamptz, edited_at timestamptz, is_deleted boolean,
  is_author boolean, can_edit boolean, can_delete boolean, reply_count integer,
  reaction_count integer, top_reactions public.post_reaction[],
  my_reaction public.post_reaction, parent_author_label text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  context record;
  parent_record public.post_comments;
  image_record public.comment_images;
  post_author_profile_id bigint;
  new_comment_id uuid := gen_random_uuid();
  new_depth smallint := 0;
  new_root_id uuid;
  new_alias smallint;
  trimmed_body text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  context := private.comment_post_context(p_post_id, caller_profile_id);
  if context.post_kind is null then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  if not context.is_visible then
    raise exception 'post is not accessible' using errcode = '42501';
  end if;

  if context.post_kind = 'profile' then
    if p_author_identity <> 'identified' then
      raise exception 'profile post comments must be identified' using errcode = '42501';
    end if;
  else
    if p_author_identity = 'identified' and context.identity_policy = 'always_anonymous' then
      raise exception 'identified commenting is not allowed' using errcode = '42501';
    end if;
    if p_author_identity = 'anonymous' and context.identity_policy = 'identified' then
      raise exception 'anonymous commenting is not allowed' using errcode = '42501';
    end if;
    if p_author_identity = 'staff'
      and context.caller_role not in ('owner', 'admin', 'manager') then
      raise exception 'staff identity is not allowed' using errcode = '42501';
    end if;
  end if;

  if char_length(trimmed_body) > 5000 then
    raise exception 'comment must contain between 1 and 5000 characters' using errcode = '22023';
  end if;
  if trimmed_body = '' and p_image_id is null then
    raise exception 'comment requires a body or finalized image' using errcode = '22023';
  end if;

  if p_parent_comment_id is not null then
    select parent.* into parent_record
    from public.post_comments as parent
    where parent.id = p_parent_comment_id and parent.deleted_at is null;
    if parent_record.id is null then
      raise exception 'parent comment not found' using errcode = 'P0002';
    end if;
    if parent_record.post_id <> p_post_id then
      raise exception 'parent comment must belong to the post' using errcode = '22023';
    end if;
    if parent_record.depth >= 10 then
      raise exception 'replies cannot nest deeper than 10 levels' using errcode = '22023';
    end if;
    new_depth := (parent_record.depth + 1)::smallint;
    new_root_id := parent_record.root_comment_id;
  else
    new_root_id := new_comment_id;
  end if;

  if p_image_id is not null then
    select image.* into image_record
    from public.comment_images as image
    where image.id = p_image_id
    for update;
    if image_record.id is null
      or image_record.post_id <> p_post_id
      or image_record.status <> 'finalized'
      or image_record.comment_id is not null
      or not private.is_comment_image_uploader(p_image_id) then
      raise exception 'finalized comment image is not claimable' using errcode = '42501';
    end if;
  end if;

  if p_author_identity = 'anonymous' then
    select author.profile_id into post_author_profile_id
    from private.post_authors as author
    where author.post_id = p_post_id;
    if context.post_author_identity = 'anonymous'
      and post_author_profile_id = caller_profile_id then
      new_alias := 0;
    else
      select alias.alias_number into new_alias
      from private.post_anonymous_aliases as alias
      where alias.post_id = p_post_id and alias.profile_id = caller_profile_id;
      if new_alias is null then
        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(p_post_id::text, 0)
        );
        select alias.alias_number into new_alias
        from private.post_anonymous_aliases as alias
        where alias.post_id = p_post_id and alias.profile_id = caller_profile_id;
        if new_alias is null then
          select coalesce(max(alias.alias_number), 0) + 1 into new_alias
          from private.post_anonymous_aliases as alias
          where alias.post_id = p_post_id;
          insert into private.post_anonymous_aliases (post_id, profile_id, alias_number)
          values (p_post_id, caller_profile_id, new_alias);
        end if;
      end if;
    end if;
  end if;

  insert into public.post_comments (
    id, post_id, parent_comment_id, root_comment_id, depth, body,
    author_identity, display_author_profile_id, anon_alias_number
  ) values (
    new_comment_id, p_post_id, p_parent_comment_id, new_root_id, new_depth, trimmed_body,
    p_author_identity,
    case when p_author_identity = 'identified' then caller_profile_id end,
    new_alias
  );
  insert into private.comment_authors (comment_id, profile_id)
  values (new_comment_id, caller_profile_id);

  if p_image_id is not null then
    update public.comment_images
    set comment_id = new_comment_id, status = 'ready', ready_at = now()
    where id = p_image_id;
  end if;

  return query
  select entry.*
  from private.read_post_comments(
    array[new_comment_id], caller_profile_id, context.caller_role
  ) as entry;
end;
$$;

drop function public.update_post_comment(uuid, text);

create function public.update_post_comment(
  p_comment_id uuid,
  p_body text,
  p_image_id uuid default null,
  p_remove_image boolean default false
)
returns table (
  comment_id uuid, post_id uuid, parent_comment_id uuid, root_comment_id uuid,
  depth smallint, body text, author_identity public.post_identity,
  author_pub_id text, author_name text, author_avatar_path text, author_label text,
  created_at timestamptz, edited_at timestamptz, is_deleted boolean,
  is_author boolean, can_edit boolean, can_delete boolean, reply_count integer,
  reaction_count integer, top_reactions public.post_reaction[],
  my_reaction public.post_reaction, parent_author_label text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  comment_record public.post_comments;
  current_image public.comment_images;
  next_image public.comment_images;
  context record;
  trimmed_body text := btrim(coalesce(p_body, ''));
  image_changed boolean;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select comment.* into comment_record
  from public.post_comments as comment
  where comment.id = p_comment_id and comment.deleted_at is null
  for update;
  if comment_record.id is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from private.comment_authors as author
    where author.comment_id = p_comment_id and author.profile_id = caller_profile_id
  ) then
    raise exception 'only the author can edit a comment' using errcode = '42501';
  end if;

  context := private.comment_post_context(comment_record.post_id, caller_profile_id);
  if not context.is_visible then
    raise exception 'post is not accessible' using errcode = '42501';
  end if;
  if char_length(trimmed_body) > 5000 then
    raise exception 'comment must contain between 1 and 5000 characters' using errcode = '22023';
  end if;
  if coalesce(p_remove_image, false) and p_image_id is not null then
    raise exception 'cannot replace and remove a comment image together' using errcode = '22023';
  end if;

  select image.* into current_image
  from public.comment_images as image
  where image.comment_id = p_comment_id and image.status = 'ready'
  for update;
  if trimmed_body = ''
    and p_image_id is null
    and (coalesce(p_remove_image, false) or current_image.id is null) then
    raise exception 'comment requires a body or finalized image' using errcode = '22023';
  end if;
  image_changed := case
    when coalesce(p_remove_image, false) then current_image.id is not null
    when p_image_id is null then false
    else current_image.id is distinct from p_image_id
  end;

  if p_image_id is not null and image_changed then
    select image.* into next_image
    from public.comment_images as image
    where image.id = p_image_id
    for update;
    if next_image.id is null
      or next_image.post_id <> comment_record.post_id
      or next_image.status <> 'finalized'
      or next_image.comment_id is not null
      or not private.is_comment_image_uploader(p_image_id) then
      raise exception 'finalized comment image is not claimable' using errcode = '42501';
    end if;
  end if;

  if image_changed and current_image.id is not null then
    update public.comment_images
    set status = 'deleted', deleted_at = now(), cleanup_lease_id = null,
      cleanup_lease_expires_at = null
    where id = current_image.id;
  end if;
  if p_image_id is not null and image_changed then
    update public.comment_images
    set comment_id = p_comment_id, status = 'ready', ready_at = now()
    where id = p_image_id;
  end if;

  update public.post_comments as comment
  set body = trimmed_body,
    edited_at = case
      when comment_record.body is distinct from trimmed_body or image_changed then now()
      else comment_record.edited_at
    end
  where comment.id = p_comment_id;

  return query
  select entry.*
  from private.read_post_comments(
    array[p_comment_id], caller_profile_id, context.caller_role
  ) as entry;
end;
$$;

create function private.tombstone_comment_images()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.comment_images
  set status = 'deleted', deleted_at = now(), cleanup_lease_id = null,
    cleanup_lease_expires_at = null
  where comment_id = new.id and status = 'ready';
  return null;
end;
$$;

revoke all on function private.tombstone_comment_images() from public, anon, authenticated;

create trigger post_comments_tombstone_images
after update of deleted_at on public.post_comments
for each row
when (old.deleted_at is null and new.deleted_at is not null)
execute function private.tombstone_comment_images();

create function private.tombstone_post_comment_images()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.comment_images
  set status = 'deleted', deleted_at = now(), cleanup_lease_id = null,
    cleanup_lease_expires_at = null
  where post_id = new.id and status <> 'deleted';
  return null;
end;
$$;

revoke all on function private.tombstone_post_comment_images() from public, anon, authenticated;

create trigger posts_tombstone_comment_images
after update of deleted_at on public.posts
for each row
when (old.deleted_at is null and new.deleted_at is not null)
execute function private.tombstone_post_comment_images();

create function private.claim_comment_image_cleanup(
  p_limit integer default 100,
  p_lease_seconds integer default 300
)
returns table (
  image_id uuid,
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
    select image.id
    from public.comment_images as image
    where (
        (image.status in ('pending', 'finalized')
          and image.created_at <= now() - interval '48 hours')
        or image.status = 'deleted'
      )
      and (
        image.cleanup_lease_expires_at is null
        or image.cleanup_lease_expires_at <= now()
      )
    order by image.created_at, image.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.comment_images as image
    set cleanup_lease_id = gen_random_uuid(),
      cleanup_lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    from candidates
    where image.id = candidates.id
    returning image.id, image.storage_bucket, image.object_path, image.cleanup_lease_id
  )
  select claimed.id, claimed.storage_bucket, claimed.object_path, claimed.cleanup_lease_id
  from claimed;
end;
$$;

create function private.complete_comment_image_cleanup(
  p_image_id uuid,
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
    delete from public.comment_images
    where id = p_image_id
      and cleanup_lease_id = p_lease_id
      and cleanup_lease_expires_at > now()
      and (
        status = 'deleted'
        or (status in ('pending', 'finalized')
          and created_at <= now() - interval '48 hours')
      );
  else
    update public.comment_images
    set cleanup_lease_id = null, cleanup_lease_expires_at = null
    where id = p_image_id and cleanup_lease_id = p_lease_id;
  end if;
  return found;
end;
$$;

revoke all on function public.prepare_comment_image(uuid, text, bigint, integer, integer)
  from public, anon;
revoke all on function public.finalize_comment_image(uuid) from public, anon;
revoke all on function public.list_comment_images(uuid[]) from public, anon;
revoke all on function public.create_post_comment(
  uuid, text, public.post_identity, uuid, uuid
) from public, anon;
revoke all on function public.update_post_comment(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.prepare_comment_image(uuid, text, bigint, integer, integer)
  to authenticated;
grant execute on function public.finalize_comment_image(uuid) to authenticated;
grant execute on function public.list_comment_images(uuid[]) to authenticated;
grant execute on function public.create_post_comment(
  uuid, text, public.post_identity, uuid, uuid
) to authenticated;
grant execute on function public.update_post_comment(uuid, text, uuid, boolean) to authenticated;

revoke all on function private.claim_comment_image_cleanup(integer, integer) from public;
revoke all on function private.complete_comment_image_cleanup(uuid, uuid, boolean) from public;
grant usage on schema private to service_role;
grant execute on function private.claim_comment_image_cleanup(integer, integer) to service_role;
grant execute on function private.complete_comment_image_cleanup(uuid, uuid, boolean)
  to service_role;
