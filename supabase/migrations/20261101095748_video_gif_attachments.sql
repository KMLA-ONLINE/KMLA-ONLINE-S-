SET local check_function_bodies = off;

ALTER TABLE "private"."message_attachments"
  DROP CONSTRAINT "message_attachments_kind_check";

ALTER TABLE "private"."message_attachments"
  DROP CONSTRAINT "message_attachments_size_check";

ALTER TABLE "public"."post_attachments"
  DROP CONSTRAINT "post_attachments_size_check";

ALTER TABLE "public"."post_attachments"
  DROP CONSTRAINT "post_attachments_thumbnail_image_only_check";

DROP FUNCTION "public"."list_post_attachments"(uuid);

DROP FUNCTION "public"."prepare_post_attachment"(uuid, text, text, bigint, integer, integer);

ALTER TABLE "public"."post_attachments"
  ADD COLUMN "media_kind" text;

CREATE OR REPLACE FUNCTION private.claim_message_attachments (
  p_caller_profile_id bigint,
  p_conversation_id   uuid,
  p_message_id        uuid
)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  pending private.message_attachments;
  uploaded storage.objects;
  ready_count integer;
begin
  for pending in
    select attachment.*
    from private.message_attachments as attachment
    where attachment.message_id = p_message_id
      and attachment.status = 'pending'
    for update
  loop
    if pending.conversation_id <> p_conversation_id
      or pending.uploader_id is distinct from p_caller_profile_id then
      raise exception 'attachment belongs to another message'
        using errcode = '42501';
    end if;

    select object.*
    into uploaded
    from storage.objects as object
    where object.bucket_id = 'message-attachments'
      and object.name = pending.object_path;

    if uploaded.id is null then
      raise exception 'uploaded attachment not found'
        using errcode = 'P0002';
    end if;
    if uploaded.owner_id is distinct from auth.uid()::text then
      raise exception 'uploaded attachment owner does not match'
        using errcode = '42501';
    end if;
    if nullif(uploaded.metadata ->> 'size', '')::bigint is distinct from pending.size_bytes
      or (pending.kind = 'image' and uploaded.metadata ->> 'mimetype' is distinct from 'image/webp')
      or (pending.kind in ('video', 'gif') and uploaded.metadata ->> 'mimetype' is distinct from 'video/mp4') then
      raise exception 'uploaded attachment does not match'
        using errcode = '22023';
    end if;

    update private.message_attachments as attachment
    set status = 'ready',
      thumbnail_path = case
        when exists (
          select 1
          from storage.objects as object
          where object.bucket_id = 'message-attachments'
            and object.name = pending.thumbnail_path
            and object.owner_id = auth.uid()::text
            and object.metadata ->> 'mimetype' = 'image/webp'
            and nullif(object.metadata ->> 'size', '')::bigint <= 1048576
        ) then pending.thumbnail_path
      end
    where attachment.id = pending.id;
  end loop;

  select count(*)
  into ready_count
  from private.message_attachments as attachment
  where attachment.message_id = p_message_id
    and attachment.conversation_id = p_conversation_id
    and attachment.status = 'ready';

  return ready_count;
end;
$function$;

CREATE OR REPLACE FUNCTION private.message_push_content (
  p_message_id           uuid,
  p_recipient_profile_id bigint,
  p_keys                 jsonb
)
  RETURNS TABLE (
    conversation_id uuid,
    title           text,
    body            text
  )
  LANGUAGE sql
  STABLE
  STRICT
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select
    message.conversation_id,
    case conversation.type
      when 'group' then conversation.name
      else coalesce(sender.name, '알 수 없는 사용자')
    end,
    left(
      case
        when conversation.type = 'group'
          then coalesce(sender_nickname.nickname, sender.name, '알 수 없는 사용자') || ': '
        else ''
      end
      || case
        when coalesce(preference.message_preview_hidden, false) then '새 메시지가 있습니다.'
        else coalesce(
          nullif(
            private.message_plain_text(
              private.decrypt_message_text(message.body_ciphertext, message.key_version, p_keys)
            ),
            ''
          ),
          -- 첨부만 있으면 종류로 쓰고 파일 이름은 넣지 않는다(기능 명세 §13.17).
          (
            select case attachment.kind
              when 'image' then '사진'
              when 'video' then '동영상'
              when 'gif' then 'GIF'
              else '파일'
            end
            from private.message_attachments as attachment
            where attachment.message_id = message.id
              and attachment.status = 'ready'
            order by attachment.position
            limit 1
          ),
          ''
        )
      end,
      240
    )
  from private.messages as message
  join public.conversations as conversation on conversation.id = message.conversation_id
  left join public.profiles as sender on sender.id = message.sender_id
  left join private.conversation_nicknames as sender_nickname
    on sender_nickname.conversation_id = message.conversation_id
    and sender_nickname.profile_id = message.sender_id
  left join public.notification_preferences as preference
    on preference.profile_id = p_recipient_profile_id
  where message.id = p_message_id
    and message.deleted_at is null;
$function$;

CREATE OR REPLACE FUNCTION private.post_attachments_json (
  p_post_id uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'attachment_id', attachment.id,
        'storage_bucket', attachment.storage_bucket,
        'object_path', attachment.object_path,
        'thumbnail_path', attachment.thumbnail_path,
        'original_filename', attachment.original_filename,
        'position', attachment.position,
        'mime_type', attachment.mime_type,
        'size_bytes', attachment.size_bytes,
        'width', attachment.width,
        'height', attachment.height,
        'media_kind', attachment.media_kind
      )
      order by attachment.position, attachment.id
    ),
    '[]'::jsonb
  )
  from public.post_attachments as attachment
  where attachment.post_id = p_post_id and attachment.status = 'ready';
$function$;

CREATE OR REPLACE FUNCTION public.get_conversation_attachment_counts (
  p_conversation_id uuid
)
  RETURNS TABLE (
    media_count integer,
    file_count  integer
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  return query
  select
    (count(*) filter (where attachment.kind in ('image', 'video', 'gif')))::integer,
    (count(*) filter (where attachment.kind not in ('image', 'video', 'gif')))::integer
  from private.message_attachments as attachment
  join private.messages as message on message.id = attachment.message_id
  where attachment.conversation_id = p_conversation_id
    and attachment.status = 'ready'
    and message.deleted_at is null
    and exists (
      select 1
      from public.conversation_members as period
      where period.conversation_id = p_conversation_id
        and period.profile_id = caller_profile_id
        and message.sent_at >= period.joined_at
        and (period.left_at is null or message.sent_at < period.left_at)
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_conversation_attachments (
  p_conversation_id uuid,
  p_media           boolean,
  p_before_sent_at  timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_before_id       uuid                     DEFAULT NULL::uuid,
  p_limit           integer                  DEFAULT 30
)
  RETURNS TABLE (
    id             uuid,
    message_id     uuid,
    sender_id      bigint,
    sent_at        timestamp with time zone,
    kind           text,
    mime_type      text,
    size_bytes     bigint,
    width          integer,
    height         integer,
    object_path    text,
    thumbnail_path text,
    file_name      text
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
  if (p_before_sent_at is null) <> (p_before_id is null) then
    raise exception 'cursor requires both sent_at and id'
      using errcode = '22023';
  end if;

  keys := private.message_keys();

  return query
  select
    attachment.id,
    message.id,
    message.sender_id,
    message.sent_at,
    attachment.kind,
    attachment.mime_type,
    attachment.size_bytes,
    attachment.width,
    attachment.height,
    attachment.object_path,
    attachment.thumbnail_path,
    private.decrypt_message_text(attachment.filename_ciphertext, attachment.key_version, keys)
  from private.message_attachments as attachment
  join private.messages as message on message.id = attachment.message_id
  where attachment.conversation_id = p_conversation_id
    and attachment.status = 'ready'
    and message.deleted_at is null
    and (attachment.kind in ('image', 'video', 'gif')) = coalesce(p_media, true)
    and (
      p_before_sent_at is null
      or (message.sent_at, attachment.id) < (p_before_sent_at, p_before_id)
    )
    and exists (
      select 1
      from public.conversation_members as period
      where period.conversation_id = p_conversation_id
        and period.profile_id = caller_profile_id
        and message.sent_at >= period.joined_at
        and (period.left_at is null or message.sent_at < period.left_at)
    )
  order by message.sent_at desc, attachment.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 101);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_post_attachments (
  p_post_id uuid
)
  RETURNS TABLE (
    attachment_id     uuid,
    post_id           uuid,
    storage_bucket    text,
    object_path       text,
    thumbnail_path    text,
    original_filename text,
    "position"        integer,
    mime_type         text,
    size_bytes        bigint,
    width             integer,
    height            integer,
    media_kind        text,
    status            public.post_attachment_status,
    created_at        timestamp with time zone,
    ready_at          timestamp with time zone
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select item.id, item.post_id, item.storage_bucket, item.object_path,
    item.thumbnail_path, item.original_filename, item.position, item.mime_type,
    item.size_bytes, item.width, item.height, item.media_kind, item.status, item.created_at,
    item.ready_at
  from public.post_attachments as item
  where item.post_id = p_post_id
    and item.status <> 'deleted'
    and (
      item.status = 'ready'
      or private.is_post_author(item.post_id)
    )
  order by item.position, item.id;
$function$;

REVOKE ALL ON FUNCTION "public"."list_post_attachments"(uuid) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.prepare_message_attachments (
  p_conversation_id uuid,
  p_message_id      uuid,
  p_files           jsonb
)
  RETURNS TABLE (
    attachment_id  uuid,
    object_path    text,
    thumbnail_path text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  keys jsonb;
  file_count integer := coalesce(jsonb_array_length(p_files), 0);
  file jsonb;
  file_position integer := 0;
  file_kind text;
  file_name text;
  encrypted record;
  path text;
  thumbnail text;
  created_id uuid;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if p_message_id is null or jsonb_typeof(p_files) is distinct from 'array' then
    raise exception 'message id and files required'
      using errcode = '22023';
  end if;
  -- 사진은 한 메시지에 30장까지 묶는다. 그 밖의 파일은 메시지마다 하나다(기능 명세 §13.5).
  if file_count not between 1 and 30 then
    raise exception 'between 1 and 30 attachments required'
      using errcode = '22023';
  end if;
  if file_count > 1 and exists (
    select 1
    from jsonb_array_elements(p_files) as item
    where item ->> 'kind' is distinct from 'image'
  ) then
    raise exception 'several attachments must all be photos'
      using errcode = '22023';
  end if;
  -- 동영상과 GIF는 브라우저가 다시 인코딩한 `video`·`gif` 종류로만 받는다(기능 명세 §13.5). 원본을 일반
  -- 파일로 보내 우회하지 못하게 MIME type과 확장자로 막는다.
  if exists (
    select 1
    from jsonb_array_elements(p_files) as item
    where coalesce(item ->> 'kind', '') not in ('video', 'gif')
      and (
        lower(btrim(coalesce(item ->> 'mime_type', ''))) like 'video/%'
        or lower(btrim(coalesce(item ->> 'mime_type', ''))) = 'image/gif'
        or (
          lower(btrim(coalesce(item ->> 'mime_type', ''))) not like 'audio/%'
          and lower(btrim(coalesce(item ->> 'file_name', '')))
            ~ '\.(gif|mp4|m4v|mov|webm|mkv|avi|wmv|flv|3gp|3g2|mpe?g|ogv)$'
        )
      )
  ) then
    raise exception 'videos and GIFs must be re-encoded'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.conversation_members as member
    where member.conversation_id = p_conversation_id
      and member.profile_id = caller_profile_id
      and member.left_at is null
  ) then
    raise exception 'conversation member required'
      using errcode = '42501';
  end if;
  if private.direct_counterpart_withdrawn(p_conversation_id, caller_profile_id) then
    -- 클라이언트가 이 거부만 골라 대화를 다시 읽으므로 hint로 구분한다. 권한 거부(42501)로 두면
    -- 세션 거절과 섞인다.
    raise exception 'recipient withdrawn'
      using errcode = '55000', hint = 'recipient_withdrawn';
  end if;
  if exists (select 1 from private.messages as message where message.id = p_message_id) then
    raise exception 'message already sent'
      using errcode = '23505';
  end if;

  update private.message_attachments as attachment
  set status = 'deleted'
  where attachment.message_id = p_message_id
    and attachment.status = 'pending'
    and attachment.uploader_id = caller_profile_id;

  keys := private.message_keys();

  for file in select item from jsonb_array_elements(p_files) as item loop
    file_kind := file ->> 'kind';
    file_name := btrim(coalesce(file ->> 'file_name', ''));
    if char_length(file_name) not between 1 and 255 then
      raise exception 'file name must be 1 to 255 characters'
        using errcode = '22023';
    end if;

    select * into encrypted from private.encrypt_message_text(file_name, keys);
    path := p_conversation_id::text || '/' || gen_random_uuid()::text;
    thumbnail := case when file_kind in ('image', 'video', 'gif') then path || '/thumb' end;

    insert into private.message_attachments (
      conversation_id, message_id, uploader_id, position, kind, mime_type, size_bytes,
      width, height, object_path, thumbnail_path, filename_ciphertext, key_version
    ) values (
      p_conversation_id,
      p_message_id,
      caller_profile_id,
      file_position,
      file_kind,
      coalesce(nullif(btrim(file ->> 'mime_type'), ''), 'application/octet-stream'),
      (file ->> 'size_bytes')::bigint,
      (file ->> 'width')::integer,
      (file ->> 'height')::integer,
      path,
      thumbnail,
      encrypted.ciphertext,
      encrypted.key_version
    )
    returning id into created_id;

    attachment_id := created_id;
    object_path := path;
    thumbnail_path := thumbnail;
    return next;
    file_position := file_position + 1;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_post_attachment (
  p_post_id           uuid,
  p_original_filename text,
  p_mime_type         text,
  p_size_bytes        bigint,
  p_width             integer DEFAULT NULL::integer,
  p_height            integer DEFAULT NULL::integer,
  p_media_kind        text    DEFAULT NULL::text
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
  where post.id = p_post_id
  for update;
  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can add attachments' using errcode = '42501';
  end if;
  -- 동영상과 GIF는 브라우저가 다시 인코딩한 MP4로만 받는다(기능 명세 §8.3). 원본은 위치 정보를 담을 수
  -- 있어 일반 파일로 우회하지 못하게 막는다. 다시 인코딩했는지 자체는 서버가 확인할 수 없다.
  if p_media_kind is not null then
    if p_media_kind not in ('video', 'gif') or btrim(p_mime_type) <> 'video/mp4' then
      raise exception 'unsupported media kind' using errcode = '22023';
    end if;
  elsif lower(btrim(p_mime_type)) like 'video/%'
     or lower(btrim(p_mime_type)) = 'image/gif'
     or lower(btrim(p_original_filename)) ~ '\.(gif|mp4|m4v|mov|webm|avi|mkv|mpeg|mpg|3gp|3g2|ogv|m2ts)$' then
    raise exception 'video attachments are not supported' using errcode = '22023';
  end if;
  if lower(btrim(p_mime_type)) like 'image/%'
    and p_size_bytes > 8388608 then
    raise exception 'image attachments must be 8 MiB or smaller' using errcode = '22023';
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

  -- 이미지와 동영상·GIF(첫 프레임)에만 썸네일 경로를 예고한다. pdf·hwp에는 축소본이랄 것이 없고, CHECK 제약도
  -- 이미지가 아닌 행에 `thumbnail_path`가 붙는 것을 막는다. 경로는 원본에서 파생되므로
  -- 클라이언트가 정하지 않는다 — Storage 정책이 이 행이 예고한 두 경로만 통과시킨다.
  insert into public.post_attachments (
    id, post_id, object_path, thumbnail_path, original_filename, position,
    mime_type, size_bytes, width, height, media_kind
  ) values (
    attachment_id, p_post_id, p_post_id::text || '/' || attachment_id::text,
    case
      when lower(btrim(p_mime_type)) like 'image/%' or p_media_kind is not null
      then p_post_id::text || '/' || attachment_id::text || '/thumb'
    end,
    btrim(p_original_filename), next_position, btrim(p_mime_type),
    p_size_bytes, p_width, p_height, p_media_kind
  ) returning * into attachment;
  return attachment;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."prepare_post_attachment"(uuid, text, text, bigint, integer, integer, text) FROM PUBLIC, "anon", "service_role";

ALTER TABLE "private"."message_attachments"
  ADD CONSTRAINT "message_attachments_kind_check" CHECK ((kind = ANY (ARRAY['image'::text, 'audio'::text, 'file'::text, 'video'::text, 'gif'::text])));

ALTER TABLE "private"."message_attachments"
  ADD CONSTRAINT "message_attachments_motion_check"
    CHECK (((kind <> ALL (ARRAY['video'::text, 'gif'::text])) OR ((mime_type = 'video/mp4'::text) AND (width IS NOT NULL) AND (height IS NOT NULL) AND ((width >= 1) AND (width <= 4096)) AND ((height >= 1) AND (height <= 4096)))));

ALTER TABLE "private"."message_attachments"
  ADD CONSTRAINT "message_attachments_size_check" CHECK (((size_bytes > 0) AND (size_bytes <=
CASE kind
    WHEN 'image'::text THEN 8388608
    WHEN 'video'::text THEN 52428800
    WHEN 'gif'::text THEN 5242880
    ELSE 31457280
END)));

ALTER TABLE "public"."post_attachments"
  ADD CONSTRAINT "post_attachments_media_kind_check"
    CHECK (((media_kind IS NULL) OR ((media_kind = ANY (ARRAY['video'::text, 'gif'::text])) AND (mime_type = 'video/mp4'::text) AND (width IS NOT NULL) AND (height IS NOT NULL) AND (width >= 1) AND (width <= 4096) AND (height >= 1) AND (height <= 4096))));

ALTER TABLE "public"."post_attachments"
  ADD CONSTRAINT "post_attachments_size_check" CHECK (((size_bytes >= 1) AND (size_bytes <=
CASE media_kind
    WHEN 'video'::text THEN 52428800
    WHEN 'gif'::text THEN 5242880
    ELSE 31457280
END)));

ALTER TABLE "public"."post_attachments"
  ADD CONSTRAINT "post_attachments_thumbnail_visual_only_check" CHECK (((thumbnail_path IS NULL) OR (mime_type ~~ 'image/%'::text) OR (media_kind IS NOT NULL)));

GRANT EXECUTE ON FUNCTION "public"."list_post_attachments"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_post_attachments"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_post_attachments"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."prepare_post_attachment"(uuid, text, text, bigint, integer, integer, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."prepare_post_attachment"(uuid, text, text, bigint, integer, integer, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."prepare_post_attachment"(uuid, text, text, bigint, integer, integer, text) TO "postgres";

-- 동영상 상한(기능 명세 §8.3, §13.5)을 버킷에도 건다. 파일별 상한은 위 제약과 클라이언트가 지킨다.
update storage.buckets
set file_size_limit = 52428800
where id in ('post-attachments', 'message-attachments');
