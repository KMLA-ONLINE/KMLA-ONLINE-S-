-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

ALTER TABLE public.post_attachments
  DROP CONSTRAINT post_attachments_position_check;

CREATE OR REPLACE FUNCTION private.apply_post_commit (
  p_post_id        uuid,
  p_body           text,
  p_attachment_ids uuid[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  attachment_count integer := cardinality(coalesce(p_attachment_ids, '{}'::uuid[]));
begin
  if char_length(coalesce(p_body, '')) > 20000 then
    raise exception 'body must contain between 0 and 20000 characters' using errcode = '22023';
  end if;
  if attachment_count > 30
    or attachment_count <> (
      select count(distinct attachment_id)
      from unnest(coalesce(p_attachment_ids, '{}'::uuid[])) as attachment_id
    ) then
    raise exception 'attachment order must contain at most 30 unique ids' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_attachment_ids, '{}'::uuid[])) as requested(id)
    where not exists (
      select 1 from public.post_attachments as attachment
      where attachment.id = requested.id
        and attachment.post_id = p_post_id
        and attachment.status <> 'deleted'
    )
  ) then
    raise exception 'attachment does not belong to this post' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.post_attachments as attachment
    left join storage.objects as object
      on object.bucket_id = attachment.storage_bucket
      and object.name = attachment.object_path
    where attachment.id = any(coalesce(p_attachment_ids, '{}'::uuid[]))
      and attachment.status = 'pending'
      and (
        object.id is null
        or object.owner_id is distinct from auth.uid()::text
        or nullif(object.metadata ->> 'size', '')::bigint is distinct from attachment.size_bytes
        or object.metadata ->> 'mimetype' is distinct from attachment.mime_type
      )
  ) then
    raise exception 'uploaded attachment metadata does not match' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null and attachment_count = 0 then
    raise exception 'post requires a body or ready attachment' using errcode = '22023';
  end if;

  update public.post_attachments
  set status = 'deleted', deleted_at = now()
  where post_id = p_post_id
    and status <> 'deleted'
    and not (id = any(coalesce(p_attachment_ids, '{}'::uuid[])));

  -- 순서를 음수로 밀어 두고 다시 매긴다. `(post_id, position)` unique 제약을 중간 상태에서
  -- 밟지 않기 위한 것이다.
  update public.post_attachments
  set position = -position - 1
  where post_id = p_post_id and status <> 'deleted';

  update public.post_attachments as attachment
  set position = requested.ordinality - 1,
    status = 'ready',
    ready_at = coalesce(attachment.ready_at, now())
  from unnest(coalesce(p_attachment_ids, '{}'::uuid[]))
    with ordinality as requested(id, ordinality)
  where attachment.id = requested.id;
end;
$function$;

ALTER FUNCTION private.apply_post_commit(uuid, text, uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.apply_post_commit(uuid, text, uuid[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.enqueue_storage_cleanup()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  enqueued bigint := 0;
  moved bigint;
begin
  -- Upload preparation and commits lock the parent too. Taking the same lock first prevents a new
  -- attachment from appearing after path capture but before the stale draft is deleted.
  perform 1
  from public.posts as post
  where post.published_at is null
    and post.created_at <= now() - interval '48 hours'
  for update;

  with expired as (
    delete from public.post_attachments as attachment
    where attachment.status = 'deleted'
      or (
        attachment.status = 'pending'
        and attachment.created_at <= now() - interval '48 hours'
      )
      or exists (
        select 1
        from public.posts as post
        where post.id = attachment.post_id
          and post.published_at is null
          and post.created_at <= now() - interval '48 hours'
      )
    returning attachment.storage_bucket as bucket, attachment.object_path as object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select expired.bucket, expired.object_path, 'post_attachment'
  from expired
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics moved = row_count;
  enqueued := enqueued + moved;

  -- Attachments are removed and queued first so deleting the parent cannot cascade away the only
  -- copy of a ready object's path. Draft-row deletion is deliberately not included in `enqueued`.
  delete from public.posts as post
  where post.published_at is null
    and post.created_at <= now() - interval '48 hours';

  with expired as (
    delete from public.comment_images as image
    where image.status = 'deleted'
      or (
        image.status in ('pending', 'finalized')
        and image.created_at <= now() - interval '48 hours'
      )
    returning image.storage_bucket as bucket, image.object_path as object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select expired.bucket, expired.object_path, 'comment_image'
  from expired
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics moved = row_count;
  enqueued := enqueued + moved;

  with expired as (
    delete from public.group_media_objects as media
    where media.status = 'deleted'
      or (
        media.status = 'pending'
        and media.created_at <= now() - interval '48 hours'
      )
    returning media.object_path as object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'group-media', expired.object_path, 'group_media'
  from expired
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics moved = row_count;
  enqueued := enqueued + moved;

  -- 프로필 이미지만 조건이 상태가 아니라 참조다. 슬롯에서 내려와도 변경 활동 게시물이 살아
  -- 있는 동안에는 남고, 그 게시물이 삭제된 뒤에야 지울 수 있다.
  with expired as (
    delete from public.profile_media_objects as media
    where (
        media.status = 'pending'
        and media.created_at <= now() - interval '48 hours'
      )
      or (
        media.status = 'ready'
        and not exists (
          select 1
          from public.profiles as profile
          where media.object_path in (profile.avatar_path, profile.cover_path)
        )
        and not exists (
          select 1
          from public.posts as post
          where post.activity_media_path = media.object_path
            and post.deleted_at is null
        )
      )
    returning media.object_path as object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'profile-media', expired.object_path, 'profile_media'
  from expired
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics moved = row_count;
  enqueued := enqueued + moved;

  return enqueued;
end;
$function$;

ALTER FUNCTION private.enqueue_storage_cleanup() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enqueue_storage_cleanup() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.prevent_post_immutable_changes()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if new.id is distinct from old.id
    or new.kind is distinct from old.kind
    or new.group_id is distinct from old.group_id
    or new.timeline_profile_id is distinct from old.timeline_profile_id
    or (
      (
        new.author_identity is distinct from old.author_identity
        or new.display_author_profile_id is distinct from old.display_author_profile_id
      )
      and not (
        current_setting('app.update_group_post_draft_identity', true) = old.id::text
        and old.published_at is null
        and old.kind = 'group'
        and old.activity_kind is null
      )
    )
    or new.body_format_version is distinct from old.body_format_version
    or new.activity_kind is distinct from old.activity_kind
    or new.activity_media_path is distinct from old.activity_media_path
    or new.created_at is distinct from old.created_at
    or (
      new.visibility is distinct from old.visibility
      and not (
        current_setting('app.commit_post', true) = '1'
        and old.kind = 'profile'
        and old.activity_kind is null
        and new.visibility is not null
      )
    )
    or (
      new.published_at is distinct from old.published_at
      and not (old.published_at is null and new.published_at is not null)
    ) then
    raise exception 'post identity and publication fields cannot be changed'
      using errcode = '55000';
  end if;
  return new;
end;
$function$;

ALTER FUNCTION private.prevent_post_immutable_changes() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.prevent_post_immutable_changes() FROM PUBLIC;

CREATE FUNCTION public.create_group_post_upload_draft (
  p_group_id        uuid,
  p_author_identity public.post_identity
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  locked_group_id uuid;
  group_identity_policy public.group_identity_policy;
  group_posting_policy public.group_posting_policy;
  member_role public.group_member_role;
  created_post_id uuid;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_author_identity is null then
    raise exception 'author identity is required' using errcode = '22023';
  end if;
  if p_author_identity = 'anonymous' then
    perform private.lock_group_anonymous_activity_target(p_group_id, caller_profile_id);
  end if;

  select group_data.id, group_data.identity_policy, group_data.posting_policy,
    membership.role
  into locked_group_id, group_identity_policy, group_posting_policy, member_role
  from public.groups as group_data
  join public.group_memberships as membership
    on membership.group_id = group_data.id and membership.profile_id = caller_profile_id
  where group_data.id = p_group_id and group_data.deleted_at is null
  for share of group_data, membership;
  if locked_group_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  if group_posting_policy = 'staff'
    and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'group posting is restricted to staff' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' and group_identity_policy = 'identified' then
    raise exception 'anonymous posting is not allowed' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' then
    perform private.assert_group_anonymous_activity_allowed(p_group_id, caller_profile_id);
  end if;
  if p_author_identity = 'staff' and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'staff identity is not allowed' using errcode = '42501';
  end if;

  insert into public.posts (
    kind, body, group_id, title, author_identity, display_author_profile_id
  ) values (
    'group', '', p_group_id, '[private upload draft]', p_author_identity,
    case when p_author_identity = 'identified' then caller_profile_id end
  ) returning id into created_post_id;
  insert into private.post_authors (post_id, profile_id)
  values (created_post_id, caller_profile_id);
  return created_post_id;
end;
$function$;

ALTER FUNCTION public.create_group_post_upload_draft(uuid, public.post_identity) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_group_post_upload_draft(uuid, public.post_identity) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_group_post_upload_draft(uuid, public.post_identity) TO authenticated;

CREATE OR REPLACE FUNCTION public.finalize_post_attachment (
  p_attachment_id uuid
)
  RETURNS public.post_attachments
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  attachment public.post_attachments;
  object_record storage.objects;
  is_published boolean;
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select item.* into attachment from public.post_attachments as item
  where item.id = p_attachment_id for update;
  if attachment.id is null or not private.is_post_author(attachment.post_id) then
    raise exception 'only the author can finalize attachments' using errcode = '42501';
  end if;
  if attachment.status = 'deleted' then
    raise exception 'attachment is not pending' using errcode = '55000';
  end if;
  select post.published_at is not null into is_published
  from public.posts as post
  where post.id = attachment.post_id and post.deleted_at is null;
  if is_published is null then
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
  if nullif(object_record.metadata ->> 'size', '')::bigint is distinct from attachment.size_bytes
    or object_record.metadata ->> 'mimetype' is distinct from attachment.mime_type then
    raise exception 'uploaded object metadata does not match' using errcode = '22023';
  end if;
  if attachment.status = 'ready' then
    return attachment;
  end if;
  if not is_published then
    update public.post_attachments
    set status = 'ready', ready_at = now()
    where id = p_attachment_id
    returning * into attachment;
  end if;
  return attachment;
end;
$function$;

ALTER FUNCTION public.finalize_post_attachment(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_post_attachment(uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.finalize_post_attachment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.prepare_post_attachment (
  p_post_id           uuid,
  p_original_filename text,
  p_mime_type         text,
  p_size_bytes        bigint,
  p_width             integer DEFAULT NULL::integer,
  p_height            integer DEFAULT NULL::integer
)
  RETURNS public.post_attachments
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
  where post.id = p_post_id and post.deleted_at is null
  for update;
  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can add attachments' using errcode = '42501';
  end if;
  if (select count(*) from public.post_attachments
      where post_id = p_post_id and status <> 'deleted') >= 30 then
    raise exception 'a post can have at most 30 attachments' using errcode = '23514';
  end if;

  select coalesce(min(candidate), 0) into next_position
  from generate_series(0, 29) as candidate
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
$function$;

ALTER FUNCTION public.prepare_post_attachment(uuid, text, text, bigint, integer, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prepare_post_attachment(uuid, text, text, bigint, integer, integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.prepare_post_attachment(uuid, text, text, bigint, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.reorder_post_attachments (
  p_post_id        uuid,
  p_attachment_ids uuid[]
)
  RETURNS SETOF public.post_attachments
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  active_count integer;
begin
  perform 1 from public.posts where id = p_post_id and deleted_at is null for update;
  if not found or not private.is_post_author(p_post_id) then
    raise exception 'only the author can reorder attachments' using errcode = '42501';
  end if;
  if p_attachment_ids is null
    or cardinality(p_attachment_ids) > 30
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
$function$;

ALTER FUNCTION public.reorder_post_attachments(uuid, uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reorder_post_attachments(uuid, uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reorder_post_attachments(uuid, uuid[]) TO authenticated;

CREATE FUNCTION public.update_group_post_draft_identity (
  p_post_id         uuid,
  p_author_identity public.post_identity
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_group_id uuid;
  locked_group_id uuid;
  group_identity_policy public.group_identity_policy;
  group_posting_policy public.group_posting_policy;
  member_role public.group_member_role;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_author_identity is null then
    raise exception 'author identity is required' using errcode = '22023';
  end if;

  select post.group_id into target_group_id
  from public.posts as post
  where post.id = p_post_id
    and post.kind = 'group'
    and post.activity_kind is null
    and post.published_at is null
    and post.deleted_at is null
    and private.is_post_author(post.id);
  if target_group_id is null then
    raise exception 'only the author can change an unpublished group draft identity'
      using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' then
    perform private.lock_group_anonymous_activity_target(target_group_id, caller_profile_id);
  end if;

  select group_data.id, group_data.identity_policy, group_data.posting_policy,
    membership.role
  into locked_group_id, group_identity_policy, group_posting_policy, member_role
  from public.groups as group_data
  join public.group_memberships as membership
    on membership.group_id = group_data.id and membership.profile_id = caller_profile_id
  where group_data.id = target_group_id and group_data.deleted_at is null
  for share of group_data, membership;
  if locked_group_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  perform 1
  from public.posts as post
  where post.id = p_post_id
    and post.kind = 'group'
    and post.group_id = target_group_id
    and post.activity_kind is null
    and post.published_at is null
    and post.deleted_at is null
    and private.is_post_author(post.id)
  for update;
  if not found then
    raise exception 'only the author can change an unpublished group draft identity'
      using errcode = '42501';
  end if;
  if group_posting_policy = 'staff'
    and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'group posting is restricted to staff' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' and group_identity_policy = 'identified' then
    raise exception 'anonymous posting is not allowed' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' then
    perform private.assert_group_anonymous_activity_allowed(target_group_id, caller_profile_id);
  end if;
  if p_author_identity = 'staff' and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'staff identity is not allowed' using errcode = '42501';
  end if;

  perform set_config('app.update_group_post_draft_identity', p_post_id::text, true);
  update public.posts
  set author_identity = p_author_identity,
    display_author_profile_id = case
      when p_author_identity = 'identified' then caller_profile_id
    end
  where id = p_post_id;
  return p_post_id;
end;
$function$;

ALTER FUNCTION public.update_group_post_draft_identity(uuid, public.post_identity) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_group_post_draft_identity(uuid, public.post_identity) FROM PUBLIC;

GRANT ALL ON FUNCTION public.update_group_post_draft_identity(uuid, public.post_identity) TO authenticated;

ALTER TABLE public.post_attachments
  ADD CONSTRAINT post_attachments_position_check CHECK ("position" >= '-30'::integer AND "position" <= 29);
