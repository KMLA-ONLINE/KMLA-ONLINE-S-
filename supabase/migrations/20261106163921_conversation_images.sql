SET local check_function_bodies = off;

DROP VIEW "private"."referenced_storage_objects";

ALTER TABLE "private"."messages"
  DROP CONSTRAINT "messages_system_check";

ALTER TABLE "private"."storage_cleanup_queue"
  DROP CONSTRAINT "storage_cleanup_queue_reason_check";

DROP FUNCTION "public"."list_conversations"(uuid);

CREATE TABLE "public"."conversation_image_objects" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" uuid                     NOT NULL,
  "auth_user_id"    uuid                     NOT NULL,
  "object_path"     text                     NOT NULL,
  "size_bytes"      bigint                   NOT NULL,
  "width"           integer                  NOT NULL,
  "height"          integer                  NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "ready_at"        timestamp with time zone,
  "deleted_at"      timestamp with time zone,
  CONSTRAINT "conversation_image_dimensions_check" CHECK (((width = height) AND ((width >= 1) AND (width <= 512)))),
  CONSTRAINT "conversation_image_objects_object_path_key" UNIQUE (object_path),
  CONSTRAINT "conversation_image_objects_pkey" PRIMARY KEY (id),
  CONSTRAINT "conversation_image_path_check" CHECK ((object_path = (((conversation_id)::text || '/'::text) || (id)::text))),
  CONSTRAINT "conversation_image_size_check" CHECK (((size_bytes >= 1) AND (size_bytes <= 1048576)))
);

ALTER TABLE "public"."conversation_image_objects"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."conversation_image_objects" FROM "anon", "authenticated";

ALTER TABLE "public"."conversations"
  ADD COLUMN "image_path" text;

CREATE TYPE "public"."conversation_image_status" AS ENUM (
  'pending',
  'ready',
  'deleted'
);

ALTER TABLE "public"."conversation_image_objects"
  ADD COLUMN "status" public.conversation_image_status NOT NULL DEFAULT 'pending'::public.conversation_image_status;

CREATE OR REPLACE FUNCTION private.can_read_conversation_image (
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
    from public.conversations as conversation
    join public.conversation_members as member
      on member.conversation_id = conversation.id
    join public.profiles as profile
      on profile.id = member.profile_id
    where conversation.image_path = p_object_path
      and profile.auth_user_id = auth.uid()
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and not private.profile_suspended(profile.id)
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_upload_conversation_image (
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
    from public.conversation_image_objects as image
    where image.object_path = p_object_path
      and image.status = 'pending'
      and image.auth_user_id = auth.uid()
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

  -- 그룹 대화 사진. 교체·삭제된 사진과 finalize되지 않은 채 48시간이 지난 예고를 회수한다.
  with expired as (
    delete from public.conversation_image_objects as image
    where image.status = 'deleted'
      or (
        image.status = 'pending'
        and image.created_at <= now() - interval '48 hours'
      )
    returning image.object_path as object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'conversation-media', expired.object_path, 'conversation_image'
  from expired
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics moved = row_count;
  enqueued := enqueued + moved;

  -- 메시지 첨부. 지운 첨부와 전송되지 않은 채 48시간이 지난 업로드 예고를 회수한다. 사진은 원본과
  -- 축소본 두 object다.
  with expired as (
    delete from private.message_attachments as attachment
    where attachment.status = 'deleted'
      or (
        attachment.status = 'pending'
        and attachment.created_at <= now() - interval '48 hours'
      )
    returning attachment.object_path, attachment.thumbnail_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'message-attachments', path.object_path, 'message_attachment'
  from expired
  cross join lateral (
    values (expired.object_path), (expired.thumbnail_path)
  ) as path(object_path)
  where path.object_path is not null
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics moved = row_count;
  enqueued := enqueued + moved;

  return enqueued;
end;
$function$;

CREATE OR REPLACE FUNCTION private.sweep_unreferenced_storage_objects (
  p_dry_run boolean DEFAULT true,
  p_limit   integer DEFAULT 1000
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  enqueued bigint;
begin
  if p_limit not between 1 and 10000 then
    raise exception 'invalid sweep limit' using errcode = '22023';
  end if;

  with unreferenced as (
    select object.bucket_id as bucket, object.name as object_path
    from storage.objects as object
    where object.bucket_id in ('profile-media', 'group-media', 'post-attachments', 'story-media', 'conversation-media')
      and object.created_at <= now() - interval '48 hours'
      and not coalesce(object.is_delete_marker, false)
      and not exists (
        select 1
        from private.referenced_storage_objects as reference
        where reference.bucket = object.bucket_id
          and reference.object_path = object.name
      )
    order by object.created_at
    limit p_limit
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason, dry_run)
  select
    unreferenced.bucket,
    unreferenced.object_path,
    'unreferenced_sweep',
    coalesce(p_dry_run, true)
  from unreferenced
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics enqueued = row_count;

  return enqueued;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_conversation_image (
  p_image_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  image public.conversation_image_objects;
  object_record storage.objects;
  previous_path text;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  select item.* into image
  from public.conversation_image_objects as item
  where item.id = p_image_id
  for update;

  if image.id is null or image.auth_user_id is distinct from auth.uid() then
    raise exception 'conversation image owner required'
      using errcode = '42501';
  end if;
  if image.status <> 'pending' then
    raise exception 'conversation image is not pending'
      using errcode = '55000';
  end if;
  perform private.lock_group_for_member(caller_profile_id, image.conversation_id);

  select object.* into object_record
  from storage.objects as object
  where object.bucket_id = 'conversation-media'
    and object.name = image.object_path;

  if object_record.id is null then
    raise exception 'uploaded object not found'
      using errcode = 'P0002';
  end if;
  if object_record.owner_id is distinct from auth.uid()::text then
    raise exception 'uploaded object owner does not match'
      using errcode = '42501';
  end if;
  if nullif(object_record.metadata ->> 'size', '')::bigint is distinct from image.size_bytes
    or object_record.metadata ->> 'mimetype' is distinct from 'image/webp' then
    raise exception 'uploaded object metadata does not match'
      using errcode = '22023';
  end if;

  select conversation.image_path into previous_path
  from public.conversations as conversation
  where conversation.id = image.conversation_id;

  update public.conversations
  set image_path = image.object_path
  where id = image.conversation_id;

  update public.conversation_image_objects
  set status = 'ready', ready_at = now()
  where id = image.id;

  if previous_path is not null and previous_path <> image.object_path then
    update public.conversation_image_objects
    set status = 'deleted', deleted_at = now()
    where object_path = previous_path and status = 'ready';
  end if;

  perform private.insert_system_message(
    image.conversation_id, 'image_changed', array[caller_profile_id]
  );

  return image.object_path;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."finalize_conversation_image"(uuid) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.list_conversations (
  p_conversation_id uuid DEFAULT NULL::uuid
)
  RETURNS TABLE (
    conversation_id              uuid,
    type                         public.conversation_type,
    name                         text,
    viewer_id                    bigint,
    participants                 jsonb,
    last_message_id              uuid,
    last_message_sender_id       bigint,
    last_message_body            text,
    last_message_sent_at         timestamp with time zone,
    last_message_deleted         boolean,
    unread_count                 integer,
    muted                        boolean,
    can_delete                   boolean,
    last_message_attachment_kind text,
    notification_level           public.conversation_notification_level,
    hidden                       boolean,
    pinned                       boolean,
    image_path                   text
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  keys jsonb;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  keys := private.message_keys();

  return query
  with latest_period as (
    -- 대화마다 가장 최근 참여 기간. 읽음 위치와 알림 설정은 이 행의 값을 쓴다.
    select distinct on (member.conversation_id) member.*
    from public.conversation_members as member
    where member.profile_id = caller_profile_id
      and (p_conversation_id is null or member.conversation_id = p_conversation_id)
    order by member.conversation_id, member.joined_at desc
  )
  select
    conversation.id,
    conversation.type,
    coalesce(conversation.name, counterpart.name),
    caller_profile_id,
    coalesce(members.list, '[]'::jsonb),
    last_message.id,
    last_message.sender_id,
    case
      when last_message.deleted_at is null and last_message.id is not null
        then private.message_plain_text(
          private.decrypt_message_text(
            last_message.body_ciphertext, last_message.key_version, keys
          )
        )
    end,
    last_message.sent_at,
    last_message.deleted_at is not null,
    coalesce(unread.count, 0)::integer,
    coalesce(latest_period.muted_until > now(), false),
    conversation.type = 'group'
      and latest_period.left_at is null
      and conversation.created_by = caller_profile_id,
    (
      select attachment.kind
      from private.message_attachments as attachment
      where attachment.message_id = last_message.id
        and attachment.status in ('ready', 'expired')
      order by attachment.position
      limit 1
    ),
    case
      when latest_period.muted_until > now() then 'off'
      when latest_period.mentions_only then 'mentions'
      else 'all'
    end::public.conversation_notification_level,
    latest_period.hidden_at is not null
      and coalesce(last_message.sent_at <= latest_period.hidden_at, true),
    latest_period.pinned_at is not null,
    conversation.image_path
  from latest_period
  join public.conversations as conversation
    on conversation.id = latest_period.conversation_id
    and (p_conversation_id is not null or not latest_period.left_by_self)
  left join public.profiles as counterpart
    on conversation.type = 'direct'
    and counterpart.id = case
      when conversation.direct_profile_low = caller_profile_id
        then conversation.direct_profile_high
      else conversation.direct_profile_low
    end
  left join lateral (
    -- 지금 멤버와 예전 멤버 모두. 나간 사람의 지난 메시지와 시스템 메시지에도 이름을 그려야 한다.
    -- 멤버 목록과 인원은 `active`인 사람만 센다.
    select jsonb_agg(
      jsonb_build_object(
        'id', profile.id,
        'pub_id', case when profile.deleted_at is null then profile.pub_id end,
        'name', profile.name,
        'nickname', case when profile.deleted_at is null then nickname.nickname end,
        'avatar_path', profile.avatar_path,
        'active', person.active,
        'withdrawn', profile.deleted_at is not null
      )
      order by person.active desc, person.first_joined_at, profile.id
    ) as list
    from (
      select
        member.profile_id,
        bool_or(member.left_at is null) as active,
        min(member.joined_at) as first_joined_at
      from public.conversation_members as member
      where member.conversation_id = conversation.id
      group by member.profile_id
    ) as person
    join public.profiles as profile on profile.id = person.profile_id
    left join private.conversation_nicknames as nickname
      on nickname.conversation_id = conversation.id
      and nickname.profile_id = person.profile_id
  ) as members on true
  left join lateral (
    select message.*
    from private.messages as message
    where message.conversation_id = conversation.id
      -- 미리보기는 사람이 보낸 메시지로 한다.
      and message.system_kind is null
      and exists (
        select 1
        from public.conversation_members as period
        where period.conversation_id = conversation.id
          and period.profile_id = caller_profile_id
          and message.sent_at >= period.joined_at
          and (period.left_at is null or message.sent_at < period.left_at)
      )
    order by message.sent_at desc, message.id desc
    limit 1
  ) as last_message on true
  left join lateral (
    select count(*) as count
    from private.messages as message
    where message.conversation_id = conversation.id
      and message.sender_id is distinct from caller_profile_id
      and message.deleted_at is null
      and message.system_kind is null
      and (message.sent_at, message.id)
        > (latest_period.last_read_sent_at, latest_period.last_read_message_id)
      and exists (
        select 1
        from public.conversation_members as period
        where period.conversation_id = conversation.id
          and period.profile_id = caller_profile_id
          and message.sent_at >= period.joined_at
          and (period.left_at is null or message.sent_at < period.left_at)
      )
  ) as unread on true
  -- 숨긴 뒤로 메시지가 없으면 목록에서 뺀다. 숨긴 대화도 대화방은 열 수 있어야 한다.
  where p_conversation_id is not null
    or latest_period.hidden_at is null
    or last_message.sent_at > latest_period.hidden_at
  -- 고정한 대화가 맨 위에 모이고, 그 안과 나머지는 마지막 메시지 순이다(기능 명세 §13.2).
  order by
    (latest_period.pinned_at is not null) desc,
    last_message.sent_at desc nulls last,
    conversation.created_at desc,
    conversation.id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_conversations"(uuid) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.prepare_conversation_image (
  p_conversation_id uuid,
  p_size_bytes      bigint,
  p_width           integer,
  p_height          integer
)
  RETURNS TABLE (
    image_id    uuid,
    object_path text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  created_id uuid := gen_random_uuid();
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  perform private.lock_group_for_member(caller_profile_id, p_conversation_id);

  insert into public.conversation_image_objects (
    id, conversation_id, auth_user_id, object_path, size_bytes, width, height
  ) values (
    created_id,
    p_conversation_id,
    auth.uid(),
    p_conversation_id::text || '/' || created_id::text,
    p_size_bytes,
    p_width,
    p_height
  );

  return query select created_id, p_conversation_id::text || '/' || created_id::text;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."prepare_conversation_image"(uuid, bigint, integer, integer) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.remove_conversation_image (
  p_conversation_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target public.conversations;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  target := private.lock_group_for_member(caller_profile_id, p_conversation_id);
  if target.image_path is null then
    return;
  end if;

  update public.conversations
  set image_path = null
  where id = p_conversation_id;

  update public.conversation_image_objects
  set status = 'deleted', deleted_at = now()
  where object_path = target.image_path and status = 'ready';

  perform private.insert_system_message(
    p_conversation_id, 'image_removed', array[caller_profile_id]
  );
end;
$function$;

REVOKE ALL ON FUNCTION "public"."remove_conversation_image"(uuid) FROM PUBLIC, "anon", "service_role";

ALTER TABLE "private"."messages"
  ADD CONSTRAINT "messages_system_check"
    CHECK
    ((((system_kind IS NULL) AND (system_profile_ids IS NULL) AND (system_name IS NULL)) OR ((system_kind = ANY (ARRAY['member_added'::text, 'member_left'::text,
    'member_removed'::text,
    'renamed'::text,
    'nickname_set'::text,
    'nickname_cleared'::text,
    'image_changed'::text,
    'image_removed'::text])) AND (sender_id IS NULL) AND (reply_to_id IS NULL) AND ((system_kind = ANY (ARRAY['renamed'::text, 'nickname_set'::text])) = (system_name IS
    NOT NULL)))));

ALTER TABLE "private"."storage_cleanup_queue"
  ADD CONSTRAINT "storage_cleanup_queue_reason_check"
    CHECK
    ((reason = ANY (ARRAY['post_attachment'::text, 'comment_image'::text, 'group_media'::text, 'profile_media'::text, 'profile_media_activity'::text, 'story_media'::text,
    'message_attachment'::text, 'conversation_image'::text, 'unreferenced_sweep'::text])));

ALTER TABLE "public"."conversation_image_objects"
  ADD CONSTRAINT "conversation_image_objects_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE "public"."conversation_image_objects"
  ADD CONSTRAINT "conversation_image_status_timestamps_check"
    CHECK
    ((((status = 'pending'::public.conversation_image_status) AND (ready_at IS NULL) AND (deleted_at IS NULL)) OR ((status = 'ready'::public.conversation_image_status) AND
    (ready_at IS NOT NULL) AND (deleted_at IS NULL)) OR ((status = 'deleted'::public.conversation_image_status) AND (ready_at IS NOT NULL) AND (deleted_at IS NOT NULL))));

CREATE VIEW "private"."referenced_storage_objects" AS  SELECT 'profile-media'::text AS bucket,
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
   FROM public.group_media_objects media
UNION ALL
 SELECT 'story-media'::text AS bucket,
    story.image_path AS object_path
   FROM public.stories story
  WHERE (story.image_path IS NOT NULL)
UNION ALL
 SELECT 'story-media'::text AS bucket,
    story.thumbnail_path AS object_path
   FROM public.stories story
  WHERE (story.thumbnail_path IS NOT NULL)
UNION ALL
 SELECT 'message-attachments'::text AS bucket,
    attachment.object_path
   FROM private.message_attachments attachment
UNION ALL
 SELECT 'message-attachments'::text AS bucket,
    attachment.thumbnail_path AS object_path
   FROM private.message_attachments attachment
  WHERE (attachment.thumbnail_path IS NOT NULL)
UNION ALL
 SELECT 'conversation-media'::text AS bucket,
    image.object_path
   FROM public.conversation_image_objects image;

CREATE INDEX conversation_image_objects_conversation_idx ON public.conversation_image_objects USING btree (conversation_id);

CREATE POLICY "conversation_image_objects_deny_direct_access" ON "public"."conversation_image_objects"
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

CREATE POLICY "conversation_media_storage_insert_pending_member" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((bucket_id = 'conversation-media'::text) AND (owner_id = ( SELECT (auth.uid())::text AS uid)) AND private.can_upload_conversation_image(name)));

CREATE POLICY "conversation_media_storage_select_member" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING
    (((bucket_id = 'conversation-media'::text) AND storage.allow_any_operation(ARRAY['object.get_authenticated_info'::text, 'object.get_authenticated'::text, 'object.sign'::text,
    'object.sign_many'::text]) AND private.can_read_conversation_image(name)));

REVOKE ALL ON FUNCTION "private"."can_read_conversation_image"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."can_read_conversation_image"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."can_upload_conversation_image"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."can_upload_conversation_image"(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."finalize_conversation_image"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."finalize_conversation_image"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."finalize_conversation_image"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_conversations"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_conversations"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_conversations"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."prepare_conversation_image"(uuid, bigint, integer, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."prepare_conversation_image"(uuid, bigint, integer, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."prepare_conversation_image"(uuid, bigint, integer, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."remove_conversation_image"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."remove_conversation_image"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."remove_conversation_image"(uuid) TO "postgres";

REVOKE ALL ON TABLE "public"."conversation_image_objects" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."conversation_image_objects" TO "postgres";

REVOKE ALL ON TABLE "public"."conversation_image_objects" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."conversation_image_objects" TO "service_role";

-- 그룹 대화 이미지 버킷(STORAGE_BUCKETS §4.7). object 하나는 1MiB까지, WebP만.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('conversation-media', 'conversation-media', false, 1048576, array['image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
