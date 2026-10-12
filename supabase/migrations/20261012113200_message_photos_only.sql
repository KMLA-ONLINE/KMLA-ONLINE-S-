SET local check_function_bodies = off;

ALTER TABLE "private"."message_attachments"
  DROP CONSTRAINT "message_attachments_kind_check";

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
          then coalesce(sender.name, '알 수 없는 사용자') || ': '
        else ''
      end
      || case
        when coalesce(preference.message_preview_hidden, false) then '새 메시지가 있습니다.'
        else coalesce(
          nullif(
            private.decrypt_message_text(message.body_ciphertext, message.key_version, p_keys),
            ''
          ),
          -- 첨부만 있으면 종류로 쓰고 파일 이름은 넣지 않는다(기능 명세 §13.17).
          (
            select case attachment.kind
              when 'image' then '사진'
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
  left join public.notification_preferences as preference
    on preference.profile_id = p_recipient_profile_id
  where message.id = p_message_id
    and message.deleted_at is null;
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
    (count(*) filter (where attachment.kind = 'image'))::integer,
    (count(*) filter (where attachment.kind <> 'image'))::integer
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
    and (attachment.kind = 'image') = coalesce(p_media, true)
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
  -- 동영상과 GIF는 보낼 수 없다(기능 명세 §13.5). 업로더가 밝힌 종류, MIME type과 확장자로 막는다.
  if exists (
    select 1
    from jsonb_array_elements(p_files) as item
    where item ->> 'kind' = 'video'
      or lower(btrim(coalesce(item ->> 'mime_type', ''))) like 'video/%'
      or lower(btrim(coalesce(item ->> 'mime_type', ''))) = 'image/gif'
      or (
        lower(btrim(coalesce(item ->> 'mime_type', ''))) not like 'audio/%'
        and lower(btrim(coalesce(item ->> 'file_name', '')))
          ~ '\.(gif|mp4|m4v|mov|webm|mkv|avi|wmv|flv|3gp|3g2|mpe?g|ogv)$'
      )
  ) then
    raise exception 'videos and GIFs are not allowed'
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
    thumbnail := case when file_kind = 'image' then path || '/thumb' end;

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

-- 메시지는 동영상을 지원하지 않는다. 예전에 올린 동영상은 지우지 않고 내려받는 일반 파일로 남긴다.
UPDATE "private"."message_attachments" SET kind = 'file' WHERE kind = 'video';

ALTER TABLE "private"."message_attachments"
  ADD CONSTRAINT "message_attachments_kind_check" CHECK ((kind = ANY (ARRAY['image'::text, 'audio'::text, 'file'::text])));
