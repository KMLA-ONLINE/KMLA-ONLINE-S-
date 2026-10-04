-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.prepare_profile_media(IN p_slot public.profile_media_slot, IN p_size_bytes bigint, IN p_width integer, IN p_height integer);

CREATE OR REPLACE FUNCTION private.can_upload_profile_media (
  p_object_path text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.profile_media_objects as media
    join public.profiles as profile on profile.id = media.profile_id
    where media.object_path = p_object_path
      and media.status = 'pending'
      and profile.auth_user_id = auth.uid()
      and profile.status = 'accepted'
      and profile.deleted_at is null
  ) or exists (
    select 1
    from public.profile_media_activity_objects as activity
    join public.profiles as profile on profile.id = activity.profile_id
    where activity.object_path = p_object_path
      and activity.status = 'pending'
      and profile.auth_user_id = auth.uid()
      and profile.status = 'accepted'
      and profile.deleted_at is null
  );
$function$;

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
    returning
      attachment.storage_bucket as bucket,
      attachment.object_path as object_path,
      attachment.thumbnail_path as thumbnail_path
  )
  -- 이미지 첨부는 object가 둘이다(원본 + 썸네일). 행은 이미 지워졌으므로 여기서 둘 다
  -- 큐에 넣지 않으면 남는 쪽의 경로를 다시 알아낼 방법이 없다.
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select expired.bucket, path.object_path, 'post_attachment'
  from expired
  cross join lateral (
    values (expired.object_path), (expired.thumbnail_path)
  ) as path(object_path)
  where path.object_path is not null
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

  -- 아바타 슬롯과 별개인 활동용 고화질본은 활동 게시물을 지웠을 때 바로 참조를 끊고 회수한다.
  -- 슬롯용 512px object는 현재 프로필이 계속 가리킬 수 있으므로 여기서 건드리지 않는다.
  with expired as (
    select activity.id, activity.object_path
    from public.profile_media_activity_objects as activity
    where (
        activity.status = 'pending'
        and activity.created_at <= now() - interval '48 hours'
      )
      or (
        activity.status = 'ready'
        and not exists (
          select 1
          from public.posts as post
          where post.activity_media_path = activity.object_path
        )
    for update
  ), deleted as (
    delete from public.profile_media_activity_objects as activity
    using expired
    where activity.id = expired.id
    returning expired.object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'profile-media', deleted.object_path, 'profile_media_activity'
  from deleted
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics moved = row_count;
  enqueued := enqueued + moved;

  return enqueued;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_profile_media (
  p_media_id uuid
)
  RETURNS public.profiles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id uuid := auth.uid();
  media public.profile_media_objects;
  activity_media public.profile_media_activity_objects;
  object_record storage.objects;
  activity_object_record storage.objects;
  current_profile public.profiles;
  updated_profile public.profiles;
  activity_post_id uuid := gen_random_uuid();
  activity_kind public.profile_media_activity_kind;
begin
  select item.* into media
  from public.profile_media_objects as item
  where item.id = p_media_id
  for update;

  if media.id is null or media.auth_user_id is distinct from caller_id then
    raise exception 'profile media owner required' using errcode = '42501';
  end if;
  if media.status <> 'pending' then
    raise exception 'profile media is not pending' using errcode = '55000';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.id = media.profile_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
  for update;

  if current_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select object.* into object_record
  from storage.objects as object
  where object.bucket_id = 'profile-media'
    and object.name = media.object_path;

  if object_record.id is null then
    raise exception 'uploaded object not found' using errcode = 'P0002';
  end if;
  if object_record.owner_id is distinct from caller_id::text then
    raise exception 'uploaded object owner does not match' using errcode = '42501';
  end if;
  if nullif(object_record.metadata ->> 'size', '')::bigint is distinct from media.size_bytes
    or object_record.metadata ->> 'mimetype' is distinct from 'image/webp' then
    raise exception 'uploaded object metadata does not match' using errcode = '22023';
  end if;

  if media.slot = 'avatar' and media.activity_media_id is null then
    raise exception 'avatar activity media required' using errcode = '55000';
  end if;

  if media.activity_media_id is not null then
    select item.* into activity_media
    from public.profile_media_activity_objects as item
    where item.id = media.activity_media_id
    for update;

    if activity_media.id is null
      or activity_media.profile_id is distinct from media.profile_id
      or activity_media.auth_user_id is distinct from caller_id
      or activity_media.status <> 'pending' then
      raise exception 'profile activity media is not pending' using errcode = '55000';
    end if;

    select object.* into activity_object_record
    from storage.objects as object
    where object.bucket_id = 'profile-media'
      and object.name = activity_media.object_path;

    if activity_object_record.id is null then
      raise exception 'uploaded activity object not found' using errcode = 'P0002';
    end if;
    if activity_object_record.owner_id is distinct from caller_id::text then
      raise exception 'uploaded activity object owner does not match' using errcode = '42501';
    end if;
    if nullif(activity_object_record.metadata ->> 'size', '')::bigint is distinct from activity_media.size_bytes
      or activity_object_record.metadata ->> 'mimetype' is distinct from 'image/webp' then
      raise exception 'uploaded activity object metadata does not match' using errcode = '22023';
    end if;
  end if;

  update public.profile_media_objects
  set status = 'ready', ready_at = now()
  where id = media.id;

  if activity_media.id is not null then
    update public.profile_media_activity_objects
    set status = 'ready', ready_at = now()
    where id = activity_media.id;
  end if;

  if media.slot = 'avatar' then
    activity_kind := 'avatar_changed';
    update public.profiles
    set avatar_path = media.object_path
    where id = current_profile.id
    returning * into updated_profile;
  else
    activity_kind := 'cover_changed';
    update public.profiles
    set cover_path = media.object_path
    where id = current_profile.id
    returning * into updated_profile;
  end if;

  insert into public.posts (
    id,
    kind,
    body,
    timeline_profile_id,
    author_identity,
    display_author_profile_id,
    visibility,
    published_at,
    activity_kind,
    activity_media_path
  ) values (
    activity_post_id,
    'profile',
    '',
    current_profile.id,
    'identified',
    current_profile.id,
    'public',
    now(),
    activity_kind,
    coalesce(activity_media.object_path, media.object_path)
  );

  insert into private.post_authors (post_id, profile_id)
  values (activity_post_id, current_profile.id);

  return updated_profile;
end;
$function$;

CREATE FUNCTION public.prepare_profile_media (
  p_slot                public.profile_media_slot,
  p_size_bytes          bigint,
  p_width               integer,
  p_height              integer,
  p_activity_size_bytes bigint                    DEFAULT NULL::bigint,
  p_activity_width      integer                   DEFAULT NULL::integer,
  p_activity_height     integer                   DEFAULT NULL::integer
)
  RETURNS TABLE (
    media_id             uuid,
    object_path          text,
    activity_media_id    uuid,
    activity_object_path text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id uuid := auth.uid();
  owner_profile_id bigint;
  created_id uuid := gen_random_uuid();
  created_activity_id uuid;
begin
  select profile.id
  into owner_profile_id
  from public.profiles as profile
  where profile.auth_user_id = caller_id
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if owner_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  if p_slot = 'avatar' then
    if p_activity_size_bytes is null or p_activity_width is null or p_activity_height is null then
      raise exception 'avatar activity rendition required' using errcode = '22023';
    end if;
    created_activity_id := gen_random_uuid();

    insert into public.profile_media_activity_objects (
      id, profile_id, auth_user_id, object_path, size_bytes, width, height
    ) values (
      created_activity_id,
      owner_profile_id,
      caller_id,
      caller_id::text || '/avatar/' || created_activity_id::text,
      p_activity_size_bytes,
      p_activity_width,
      p_activity_height
    );
  elsif p_activity_size_bytes is not null or p_activity_width is not null or p_activity_height is not null then
    raise exception 'cover media does not use an activity rendition' using errcode = '22023';
  end if;

  insert into public.profile_media_objects (
    id, profile_id, auth_user_id, slot, object_path, size_bytes, width, height, activity_media_id
  ) values (
    created_id,
    owner_profile_id,
    caller_id,
    p_slot,
    caller_id::text || '/' || p_slot::text || '/' || created_id::text,
    p_size_bytes,
    p_width,
    p_height,
    created_activity_id
  );

  return query select created_id,
    caller_id::text || '/' || p_slot::text || '/' || created_id::text,
    created_activity_id,
    case when created_activity_id is not null
      then caller_id::text || '/avatar/' || created_activity_id::text
    end;
end;
$function$;

ALTER FUNCTION public.prepare_profile_media(public.profile_media_slot, bigint, integer, integer, bigint, integer, integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.prepare_profile_media(public.profile_media_slot, bigint, integer, integer, bigint, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.prepare_profile_media(public.profile_media_slot, bigint, integer, integer, bigint, integer, integer) TO authenticated;

CREATE TABLE public.profile_media_activity_objects (
  id           uuid                        DEFAULT gen_random_uuid() NOT NULL,
  profile_id   bigint                      NOT NULL,
  auth_user_id uuid                        NOT NULL,
  object_path  text                        NOT NULL,
  size_bytes   bigint                      NOT NULL,
  width        integer                     NOT NULL,
  height       integer                     NOT NULL,
  status       public.profile_media_status DEFAULT 'pending'::public.profile_media_status NOT NULL,
  created_at   timestamp with time zone    DEFAULT now() NOT NULL,
  ready_at     timestamp with time zone
);

ALTER TABLE public.profile_media_activity_objects OWNER TO postgres;

CREATE OR REPLACE VIEW private.referenced_storage_objects AS SELECT 'profile-media'::text AS bucket,
    profile.avatar_path AS object_path
   FROM public.profiles profile
  WHERE (profile.avatar_path IS NOT NULL)
UNION ALL
 SELECT 'profile-media'::text AS bucket,
    profile.cover_path AS object_path
   FROM public.profiles profile
  WHERE (profile.cover_path IS NOT NULL)
UNION ALL
 SELECT 'profile-media'::text AS bucket,
    post.activity_media_path AS object_path
   FROM public.posts post
  WHERE (post.activity_media_path IS NOT NULL)
UNION ALL
 SELECT 'profile-media'::text AS bucket,
    media.object_path
   FROM public.profile_media_objects media
UNION ALL
 SELECT 'profile-media'::text AS bucket,
    activity.object_path
   FROM public.profile_media_activity_objects activity
UNION ALL
 SELECT attachment.storage_bucket AS bucket,
    attachment.object_path
   FROM public.post_attachments attachment
UNION ALL
 SELECT attachment.storage_bucket AS bucket,
    attachment.thumbnail_path AS object_path
   FROM public.post_attachments attachment
  WHERE (attachment.thumbnail_path IS NOT NULL)
UNION ALL
 SELECT image.storage_bucket AS bucket,
    image.object_path
   FROM public.comment_images image
UNION ALL
 SELECT 'group-media'::text AS bucket,
    media.object_path
   FROM public.group_media_objects media;

ALTER TABLE public.profile_media_activity_objects
  ENABLE ROW LEVEL SECURITY;

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.profile_media_activity_objects FROM anon, authenticated;

REVOKE ALL ON TABLE public.profile_media_activity_objects FROM anon, authenticated;

ALTER TABLE public.profile_media_activity_objects
  ADD CONSTRAINT profile_media_activity_dimensions_check CHECK (width = height AND width >= 1 AND width <= 2048);

ALTER TABLE public.profile_media_activity_objects
  ADD CONSTRAINT profile_media_activity_objects_object_path_key UNIQUE (object_path);

ALTER TABLE public.profile_media_activity_objects
  ADD CONSTRAINT profile_media_activity_objects_pkey PRIMARY KEY (id);

ALTER TABLE public.profile_media_activity_objects
  ADD CONSTRAINT profile_media_activity_objects_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.profile_media_activity_objects
  ADD CONSTRAINT profile_media_activity_path_check CHECK (object_path = ((auth_user_id::text || '/avatar/'::text) || id::text));

ALTER TABLE public.profile_media_activity_objects
  ADD CONSTRAINT profile_media_activity_size_check CHECK (size_bytes >= 1 AND size_bytes <= 4194304);

ALTER TABLE public.profile_media_activity_objects
  ADD CONSTRAINT profile_media_activity_status_timestamps_check
    CHECK (status = 'pending'::public.profile_media_status AND ready_at IS NULL OR status = 'ready'::public.profile_media_status AND ready_at IS NOT NULL);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.profile_media_activity_objects TO service_role;

CREATE INDEX profile_media_activity_objects_cleanup_idx ON public.profile_media_activity_objects (created_at, id);

CREATE POLICY profile_media_activity_objects_deny_client_access ON public.profile_media_activity_objects
  USING (false)
  WITH CHECK (false);

ALTER TABLE public.profile_media_objects
  ADD COLUMN activity_media_id uuid;

ALTER TABLE public.profile_media_objects
  ADD CONSTRAINT profile_media_objects_activity_media_id_fkey FOREIGN KEY (activity_media_id) REFERENCES public.profile_media_activity_objects(id) ON DELETE SET NULL;
