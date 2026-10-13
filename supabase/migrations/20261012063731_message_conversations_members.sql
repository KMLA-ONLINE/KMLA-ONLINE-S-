SET local check_function_bodies = off;

-- 메시지 첨부 버킷(Storage 설계 §4.4). 버킷 행은 diff가 표현하지 못해 직접 넣는다. 형식은 제한하지 않고
-- object 하나는 30MiB까지다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-attachments', 'message-attachments', false, 31457280, null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP VIEW "private"."referenced_storage_objects";

ALTER TABLE "private"."messages"
  DROP CONSTRAINT "messages_body_check";

ALTER TABLE "private"."storage_cleanup_queue"
  DROP CONSTRAINT "storage_cleanup_queue_reason_check";

DROP FUNCTION "private"."message_rows"(bigint, uuid, uuid[], jsonb);

DROP FUNCTION "public"."list_conversations"(uuid);

DROP FUNCTION "public"."list_message_changes"(uuid, timestamp WITH time zone, integer);

DROP FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer);

DROP FUNCTION "public"."list_pinned_messages"(uuid);

CREATE TABLE "private"."message_attachments" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id"     uuid                     NOT NULL,
  "message_id"          uuid                     NOT NULL,
  "uploader_id"         bigint,
  "status"              text                     NOT NULL DEFAULT 'pending'::text,
  "position"            smallint                 NOT NULL,
  "kind"                text                     NOT NULL,
  "mime_type"           text                     NOT NULL,
  "size_bytes"          bigint                   NOT NULL,
  "width"               integer,
  "height"              integer,
  "object_path"         text                     NOT NULL,
  "thumbnail_path"      text,
  "filename_ciphertext" bytea                    NOT NULL,
  "key_version"         smallint                 NOT NULL,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "message_attachments_image_check"
    CHECK (((kind <> 'image'::text) OR ((mime_type = 'image/webp'::text) AND ((width >= 1) AND (width <= 3072)) AND ((height >= 1) AND (height <= 3072))))),
  CONSTRAINT "message_attachments_kind_check" CHECK ((kind = ANY (ARRAY['image'::text, 'video'::text, 'audio'::text, 'file'::text]))),
  CONSTRAINT "message_attachments_mime_check" CHECK (((char_length(mime_type) >= 1) AND (char_length(mime_type) <= 255))),
  CONSTRAINT "message_attachments_object_path_key" UNIQUE (object_path),
  CONSTRAINT "message_attachments_pkey" PRIMARY KEY (id),
  CONSTRAINT "message_attachments_size_check" CHECK (((size_bytes > 0) AND (size_bytes <=
CASE
    WHEN (kind = 'image'::text) THEN 8388608
    ELSE 31457280
END))),
  CONSTRAINT "message_attachments_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'ready'::text, 'deleted'::text]))),
  CONSTRAINT "message_attachments_thumbnail_path_key" UNIQUE (thumbnail_path)
);

ALTER TABLE "private"."message_attachments"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "private"."message_attachments" FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "private"."messages"
  ADD COLUMN "system_kind" text;

ALTER TABLE "private"."messages"
  ADD COLUMN "system_profile_ids" bigint[];

ALTER TABLE "private"."messages"
  ADD COLUMN "system_name" text;

ALTER TABLE "public"."conversation_members"
  ALTER COLUMN "joined_at" SET DEFAULT clock_timestamp();

ALTER TABLE "public"."conversation_members"
  ALTER COLUMN "last_read_sent_at" SET DEFAULT clock_timestamp();

CREATE OR REPLACE FUNCTION private.can_read_message_object (
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
    from private.message_attachments as attachment
    join private.messages as message on message.id = attachment.message_id
    join public.conversation_members as period
      on period.conversation_id = message.conversation_id
      and period.profile_id = private.current_profile_id()
      and message.sent_at >= period.joined_at
      and (period.left_at is null or message.sent_at < period.left_at)
    where p_object_path in (attachment.object_path, attachment.thumbnail_path)
      and attachment.status = 'ready'
      and message.deleted_at is null
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_upload_message_object (
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
    from private.message_attachments as attachment
    where p_object_path in (attachment.object_path, attachment.thumbnail_path)
      and attachment.status = 'pending'
      and attachment.uploader_id = private.current_profile_id()
  );
$function$;

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
      or (pending.kind = 'image' and uploaded.metadata ->> 'mimetype' is distinct from 'image/webp') then
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

CREATE OR REPLACE FUNCTION private.conversation_member_limit()
  RETURNS integer
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select 100;
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

CREATE OR REPLACE FUNCTION private.insert_system_message (
  p_conversation_id uuid,
  p_kind            text,
  p_profile_ids     bigint[],
  p_name            text     DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  insert into private.messages (
    id, conversation_id, sent_at, system_kind, system_profile_ids, system_name
  ) values (
    gen_random_uuid(), p_conversation_id, clock_timestamp(), p_kind, p_profile_ids, p_name
  );
$function$;

CREATE OR REPLACE FUNCTION private.lock_actionable_message (
  p_caller_profile_id bigint,
  p_message_id        uuid
)
  RETURNS private.messages
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  target private.messages;
begin
  select message.*
  into target
  from private.messages as message
  where message.id = p_message_id
    and message.deleted_at is null
    and message.system_kind is null
    and exists (
      select 1
      from public.conversation_members as member
      where member.conversation_id = message.conversation_id
        and member.profile_id = p_caller_profile_id
        and member.left_at is null
    )
    and exists (
      select 1
      from public.conversation_members as period
      where period.conversation_id = message.conversation_id
        and period.profile_id = p_caller_profile_id
        and message.sent_at >= period.joined_at
        and (period.left_at is null or message.sent_at < period.left_at)
    )
  -- 키를 바꾸지 않으므로 `no key update`면 된다. 이 메시지에 답장하는 전송의 외래 키 검사
  -- (`key share`)를 막지 않으면서 삭제와는 순서가 잡힌다.
  for no key update;

  if target.id is null then
    raise exception 'message unavailable'
      using errcode = 'P0002';
  end if;

  return target;
end;
$function$;

CREATE OR REPLACE FUNCTION private.lock_group_for_member (
  p_caller_profile_id bigint,
  p_conversation_id   uuid
)
  RETURNS public.conversations
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  target public.conversations;
begin
  select conversation.*
  into target
  from public.conversations as conversation
  where conversation.id = p_conversation_id
    and conversation.type = 'group'
    and exists (
      select 1
      from public.conversation_members as member
      where member.conversation_id = conversation.id
        and member.profile_id = p_caller_profile_id
        and member.left_at is null
    )
  for no key update;

  if target.id is null then
    raise exception 'group member required'
      using errcode = '42501';
  end if;
  return target;
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
              when 'video' then '동영상'
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

CREATE OR REPLACE FUNCTION private.message_rows (
  p_caller_profile_id bigint,
  p_conversation_id   uuid,
  p_message_ids       uuid[],
  p_keys              jsonb
)
  RETURNS TABLE (
    id                  uuid,
    sender_id           bigint,
    body                text,
    sent_at             timestamp with time zone,
    edited_at           timestamp with time zone,
    deleted             boolean,
    reply_to_id         uuid,
    reply_sender_id     bigint,
    reply_body          text,
    reply_deleted       boolean,
    unread_member_count integer,
    reactions           jsonb,
    my_reaction         public.post_reaction,
    pinned              boolean,
    changed_at          timestamp with time zone,
    system_kind         text,
    system_profile_ids  bigint[],
    system_name         text,
    attachments         jsonb
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  with period as (
    select member.joined_at, member.left_at
    from public.conversation_members as member
    where member.conversation_id = p_conversation_id
      and member.profile_id = p_caller_profile_id
  )
  select
    message.id,
    message.sender_id,
    case
      when message.system_kind is null and message.deleted_at is null
        then private.decrypt_message_text(message.body_ciphertext, message.key_version, p_keys)
      else ''
    end,
    message.sent_at,
    message.edited_at,
    message.deleted_at is not null,
    original.id,
    original.sender_id,
    case
      when original.id is not null and original.deleted_at is null
        then left(
          private.decrypt_message_text(original.body_ciphertext, original.key_version, p_keys),
          200
        )
      when original.id is not null then ''
    end,
    original.deleted_at is not null,
    case
      when message.sender_id = p_caller_profile_id then (
        select count(*)::integer
        from public.conversation_members as other
        where other.conversation_id = p_conversation_id
          and other.profile_id <> p_caller_profile_id
          and other.left_at is null
          and other.joined_at <= message.sent_at
          and (other.last_read_sent_at, other.last_read_message_id) < (message.sent_at, message.id)
      )
    end,
    coalesce(tally.list, '[]'::jsonb),
    mine.reaction,
    pin.message_id is not null,
    message.changed_at,
    message.system_kind,
    message.system_profile_ids,
    message.system_name,
    coalesce(files.list, '[]'::jsonb)
  from private.messages as message
  left join private.messages as original
    on original.id = message.reply_to_id
    and exists (
      select 1
      from period
      where original.sent_at >= period.joined_at
        and (period.left_at is null or original.sent_at < period.left_at)
    )
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('reaction', counted.reaction, 'count', counted.n)
      order by counted.n desc, counted.reaction
    ) as list
    from (
      select entry.reaction, count(*)::integer as n
      from private.message_reactions as entry
      where entry.message_id = message.id
      group by entry.reaction
    ) as counted
  ) as tally on true
  left join private.message_reactions as mine
    on mine.message_id = message.id
    and mine.profile_id = p_caller_profile_id
  left join private.message_pins as pin on pin.message_id = message.id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', attachment.id,
        'kind', attachment.kind,
        'mime_type', attachment.mime_type,
        'size_bytes', attachment.size_bytes,
        'width', attachment.width,
        'height', attachment.height,
        'object_path', attachment.object_path,
        'thumbnail_path', attachment.thumbnail_path,
        'file_name', private.decrypt_message_text(
          attachment.filename_ciphertext, attachment.key_version, p_keys
        )
      )
      order by attachment.position
    ) as list
    from private.message_attachments as attachment
    where attachment.message_id = message.id
      and attachment.conversation_id = message.conversation_id
      and attachment.status = 'ready'
  ) as files on true
  where message.conversation_id = p_conversation_id
    and message.id = any(p_message_ids)
  order by message.sent_at, message.id;
$function$;

CREATE OR REPLACE FUNCTION public.add_conversation_members (
  p_conversation_id uuid,
  p_profile_ids     bigint[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  added_ids bigint[];
  active_count integer;
  joined timestamptz;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  perform private.lock_group_for_member(caller_profile_id, p_conversation_id);

  select coalesce(array_agg(distinct person.id), array[]::bigint[])
  into added_ids
  from public.profiles as person
  where person.id = any(p_profile_ids)
    and person.status = 'accepted'
    and person.deleted_at is null
    and not exists (
      select 1
      from public.conversation_members as member
      where member.conversation_id = p_conversation_id
        and member.profile_id = person.id
        and member.left_at is null
    );

  if cardinality(added_ids) = 0 then
    return;
  end if;

  select count(*)
  into active_count
  from public.conversation_members as member
  where member.conversation_id = p_conversation_id
    and member.left_at is null;

  if active_count + cardinality(added_ids) > private.conversation_member_limit() then
    raise exception 'group member limit exceeded'
      using errcode = '54000';
  end if;

  joined := clock_timestamp();
  insert into public.conversation_members (
    conversation_id, profile_id, joined_at, last_read_sent_at
  )
  select p_conversation_id, added_id, joined, joined
  from unnest(added_ids) as added_id;

  perform private.insert_system_message(
    p_conversation_id, 'member_added', array_prepend(caller_profile_id, added_ids)
  );
end;
$function$;

REVOKE ALL ON FUNCTION "public"."add_conversation_members"(uuid, bigint[]) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.create_group_conversation (
  p_name        text,
  p_profile_ids bigint[]
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  invitee_ids bigint[];
  conversation_id uuid;
  joined timestamptz;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 50 then
    raise exception 'group name must be 1 to 50 characters'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct person.id), array[]::bigint[])
  into invitee_ids
  from public.profiles as person
  where person.id = any(p_profile_ids)
    and person.id <> caller_profile_id
    and person.status = 'accepted'
    and person.deleted_at is null;

  if cardinality(invitee_ids) = 0 then
    raise exception 'at least one other member required'
      using errcode = '22023';
  end if;
  if cardinality(invitee_ids) + 1 > private.conversation_member_limit() then
    raise exception 'group member limit exceeded'
      using errcode = '54000';
  end if;

  insert into public.conversations (type, name, created_by)
  values ('group', btrim(p_name), caller_profile_id)
  returning id into conversation_id;

  joined := clock_timestamp();
  insert into public.conversation_members (
    conversation_id, profile_id, joined_at, last_read_sent_at
  )
  select conversation_id, member_id, joined, joined
  from unnest(array_prepend(caller_profile_id, invitee_ids)) as member_id;

  -- 만든 일도 초대로 남긴다. 이 메시지의 Realtime 신호가 초대받은 사람의 목록에 새 대화를 띄운다.
  perform private.insert_system_message(
    conversation_id, 'member_added', array_prepend(caller_profile_id, invitee_ids)
  );

  return conversation_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."create_group_conversation"(text, bigint[]) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.delete_messages (
  p_message_ids uuid[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  previous_suppression text;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if coalesce(cardinality(p_message_ids), 0) not between 1 and 100 then
    raise exception 'between 1 and 100 messages required'
      using errcode = '22023';
  end if;

  perform 1
  from private.messages as message
  where message.id = any(p_message_ids)
  for update;

  if exists (
    select 1
    from unnest(p_message_ids) as requested(id)
    left join private.messages as message on message.id = requested.id
    where message.sender_id is distinct from caller_profile_id
  ) then
    raise exception 'message sender required'
      using errcode = '42501';
  end if;

  -- 반응·고정 행을 지울 때마다 trigger가 메시지를 고치고 신호를 보내지 않도록 그동안 신호를 끈다.
  -- 마지막 메시지 갱신이 한 번만 신호를 보낸다. 운영 작업이 이미 꺼 두었다면 그 값으로 돌려놓는다.
  previous_suppression := current_setting('messaging.suppress_signals', true);
  perform set_config('messaging.suppress_signals', 'on', true);

  delete from private.message_reactions as entry
  where entry.message_id = any(p_message_ids);

  delete from private.message_pins as pin
  where pin.message_id = any(p_message_ids);

  perform set_config(
    'messaging.suppress_signals', coalesce(previous_suppression, 'off'), true
  );

  -- 첨부 object는 Storage 정리 작업이 `deleted` 행을 지우며 회수한다.
  update private.message_attachments as attachment
  set status = 'deleted'
  where attachment.message_id = any(p_message_ids)
    and attachment.status <> 'deleted';

  update private.messages as message
  set deleted_at = clock_timestamp(),
    body_ciphertext = null,
    key_version = null
  where message.id = any(p_message_ids)
    and message.deleted_at is null;
end;
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
    (count(*) filter (where attachment.kind in ('image', 'video')))::integer,
    (count(*) filter (where attachment.kind not in ('image', 'video')))::integer
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

REVOKE ALL ON FUNCTION "public"."get_conversation_attachment_counts"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_my_unread_message_count()
  RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  total integer;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  with latest_period as (
    select distinct on (member.conversation_id) member.*
    from public.conversation_members as member
    where member.profile_id = caller_profile_id
    order by member.conversation_id, member.joined_at desc
  )
  select count(*)::integer
  into total
  from latest_period
  join private.messages as message
    on message.conversation_id = latest_period.conversation_id
    and message.sender_id is distinct from caller_profile_id
    and message.deleted_at is null
    and message.system_kind is null
    and (message.sent_at, message.id)
      > (latest_period.last_read_sent_at, latest_period.last_read_message_id)
  where exists (
    select 1
    from public.conversation_members as period
    where period.conversation_id = latest_period.conversation_id
      and period.profile_id = caller_profile_id
      and message.sent_at >= period.joined_at
      and (period.left_at is null or message.sent_at < period.left_at)
  );

  return total;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."get_my_unread_message_count"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.leave_conversation (
  p_conversation_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
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

  perform private.lock_group_for_member(caller_profile_id, p_conversation_id);

  update public.conversation_members as member
  set left_at = clock_timestamp()
  where member.conversation_id = p_conversation_id
    and member.profile_id = caller_profile_id
    and member.left_at is null;

  perform private.insert_system_message(
    p_conversation_id, 'member_left', array[caller_profile_id]
  );
end;
$function$;

REVOKE ALL ON FUNCTION "public"."leave_conversation"(uuid) FROM PUBLIC, "anon";

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
    and (attachment.kind in ('image', 'video')) = coalesce(p_media, true)
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

REVOKE ALL ON FUNCTION "public"."list_conversation_attachments"(uuid, boolean, timestamp WITH time zone, uuid, integer) FROM PUBLIC, "anon";

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
    can_manage_members           boolean,
    last_message_attachment_kind text
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
        then private.decrypt_message_text(
          last_message.body_ciphertext, last_message.key_version, keys
        )
    end,
    last_message.sent_at,
    last_message.deleted_at is not null,
    coalesce(unread.count, 0)::integer,
    coalesce(latest_period.muted_until > now(), false),
    conversation.type = 'group'
      and latest_period.left_at is null
      and (conversation.created_by = caller_profile_id or caller.role = 'admin'),
    (
      select attachment.kind
      from private.message_attachments as attachment
      where attachment.message_id = last_message.id
        and attachment.status = 'ready'
      order by attachment.position
      limit 1
    )
  from latest_period
  join public.profiles as caller on caller.id = caller_profile_id
  join public.conversations as conversation
    on conversation.id = latest_period.conversation_id
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
        'name', profile.name,
        'avatar_path', profile.avatar_path,
        'active', person.active
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
  order by last_message.sent_at desc nulls last, conversation.created_at desc, conversation.id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_conversations"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.list_message_changes (
  p_conversation_id uuid,
  p_since           timestamp with time zone,
  p_limit           integer                  DEFAULT 100
)
  RETURNS TABLE (
    id                  uuid,
    sender_id           bigint,
    body                text,
    sent_at             timestamp with time zone,
    edited_at           timestamp with time zone,
    deleted             boolean,
    reply_to_id         uuid,
    reply_sender_id     bigint,
    reply_body          text,
    reply_deleted       boolean,
    unread_member_count integer,
    reactions           jsonb,
    my_reaction         public.post_reaction,
    pinned              boolean,
    changed_at          timestamp with time zone,
    system_kind         text,
    system_profile_ids  bigint[],
    system_name         text,
    attachments         jsonb
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  changed_ids uuid[];
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if p_since is null then
    raise exception 'since required'
      using errcode = '22023';
  end if;

  select array_agg(changed.id)
  into changed_ids
  from (
    select message.id
    from private.messages as message
    where message.conversation_id = p_conversation_id
      and message.changed_at > p_since - interval '10 seconds'
      and exists (
        select 1
        from public.conversation_members as period
        where period.conversation_id = p_conversation_id
          and period.profile_id = caller_profile_id
          and message.sent_at >= period.joined_at
          and (period.left_at is null or message.sent_at < period.left_at)
      )
    order by message.changed_at, message.id
    limit least(greatest(coalesce(p_limit, 100), 1), 200)
  ) as changed;

  if changed_ids is null then
    return;
  end if;

  return query
  select *
  from private.message_rows(
    caller_profile_id, p_conversation_id, changed_ids, private.message_keys()
  );
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_message_changes"(uuid, timestamp WITH time zone, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.list_message_reactors (
  p_message_id uuid
)
  RETURNS TABLE (
    profile_id  bigint,
    name        text,
    avatar_path text,
    reaction    public.post_reaction,
    reacted_at  timestamp with time zone
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
  select profile.id, profile.name, profile.avatar_path, entry.reaction, entry.created_at
  from private.message_reactions as entry
  join private.messages as message on message.id = entry.message_id
  join public.profiles as profile on profile.id = entry.profile_id
  where entry.message_id = p_message_id
    and exists (
      select 1
      from public.conversation_members as period
      where period.conversation_id = message.conversation_id
        and period.profile_id = caller_profile_id
        and message.sent_at >= period.joined_at
        and (period.left_at is null or message.sent_at < period.left_at)
    )
  order by entry.reaction, entry.created_at, profile.id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_message_reactors"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.list_messages (
  p_conversation_id uuid,
  p_before_sent_at  timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_before_id       uuid                     DEFAULT NULL::uuid,
  p_limit           integer                  DEFAULT 50
)
  RETURNS TABLE (
    id                  uuid,
    sender_id           bigint,
    body                text,
    sent_at             timestamp with time zone,
    edited_at           timestamp with time zone,
    deleted             boolean,
    reply_to_id         uuid,
    reply_sender_id     bigint,
    reply_body          text,
    reply_deleted       boolean,
    unread_member_count integer,
    reactions           jsonb,
    my_reaction         public.post_reaction,
    pinned              boolean,
    changed_at          timestamp with time zone,
    system_kind         text,
    system_profile_ids  bigint[],
    system_name         text,
    attachments         jsonb
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  page_ids uuid[];
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if (p_before_sent_at is null) <> (p_before_id is null) then
    raise exception 'cursor requires both sent_at and id'
      using errcode = '22023';
  end if;

  select array_agg(page.id)
  into page_ids
  from (
    select message.id
    from private.messages as message
    where message.conversation_id = p_conversation_id
      and (
        p_before_sent_at is null
        or (message.sent_at, message.id) < (p_before_sent_at, p_before_id)
      )
      and exists (
        select 1
        from public.conversation_members as period
        where period.conversation_id = p_conversation_id
          and period.profile_id = caller_profile_id
          and message.sent_at >= period.joined_at
          and (period.left_at is null or message.sent_at < period.left_at)
      )
    order by message.sent_at desc, message.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 101)
  ) as page;

  if page_ids is null then
    return;
  end if;

  return query
  select *
  from private.message_rows(
    caller_profile_id, p_conversation_id, page_ids, private.message_keys()
  );
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.list_pinned_messages (
  p_conversation_id uuid
)
  RETURNS TABLE (
    id                  uuid,
    sender_id           bigint,
    body                text,
    sent_at             timestamp with time zone,
    edited_at           timestamp with time zone,
    deleted             boolean,
    reply_to_id         uuid,
    reply_sender_id     bigint,
    reply_body          text,
    reply_deleted       boolean,
    unread_member_count integer,
    reactions           jsonb,
    my_reaction         public.post_reaction,
    pinned              boolean,
    changed_at          timestamp with time zone,
    system_kind         text,
    system_profile_ids  bigint[],
    system_name         text,
    attachments         jsonb
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  pinned_ids uuid[];
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  select array_agg(pin.message_id)
  into pinned_ids
  from private.message_pins as pin
  join private.messages as message on message.id = pin.message_id
  where pin.conversation_id = p_conversation_id
    and exists (
      select 1
      from public.conversation_members as period
      where period.conversation_id = p_conversation_id
        and period.profile_id = caller_profile_id
        and message.sent_at >= period.joined_at
        and (period.left_at is null or message.sent_at < period.left_at)
    );

  if pinned_ids is null then
    return;
  end if;

  return query
  select *
  from private.message_rows(
    caller_profile_id, p_conversation_id, pinned_ids, private.message_keys()
  );
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_pinned_messages"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.open_direct_conversation (
  p_profile_id bigint
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  low_id bigint;
  high_id bigint;
  conversation_id uuid;
  joined timestamptz;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if p_profile_id is null or p_profile_id = caller_profile_id then
    raise exception 'another profile required'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.profiles as person
    where person.id = p_profile_id
      and person.status = 'accepted'
      and person.deleted_at is null
  ) then
    raise exception 'recipient unavailable'
      using errcode = 'P0002';
  end if;

  low_id := least(caller_profile_id, p_profile_id);
  high_id := greatest(caller_profile_id, p_profile_id);

  insert into public.conversations (type, created_by, direct_profile_low, direct_profile_high)
  values ('direct', caller_profile_id, low_id, high_id)
  on conflict on constraint conversations_direct_pair_key do nothing
  returning id into conversation_id;

  if conversation_id is null then
    select conversation.id
    into conversation_id
    from public.conversations as conversation
    where conversation.direct_profile_low = low_id
      and conversation.direct_profile_high = high_id;
    return conversation_id;
  end if;

  joined := clock_timestamp();
  insert into public.conversation_members (
    conversation_id, profile_id, joined_at, last_read_sent_at
  )
  values (conversation_id, low_id, joined, joined), (conversation_id, high_id, joined, joined);

  return conversation_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."open_direct_conversation"(bigint) FROM PUBLIC, "anon";

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
  if file_count not between 1 and 10 then
    raise exception 'between 1 and 10 attachments required'
      using errcode = '22023';
  end if;
  if file_count > 1 and exists (
    select 1
    from jsonb_array_elements(p_files) as item
    where item ->> 'kind' not in ('image', 'video')
  ) then
    raise exception 'several attachments must all be photos or videos'
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

REVOKE ALL ON FUNCTION "public"."prepare_message_attachments"(uuid, uuid, jsonb) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.remove_conversation_member (
  p_conversation_id uuid,
  p_profile_id      bigint
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
  if p_profile_id is null or p_profile_id = caller_profile_id then
    raise exception 'another member required'
      using errcode = '22023';
  end if;

  target := private.lock_group_for_member(caller_profile_id, p_conversation_id);

  if target.created_by is distinct from caller_profile_id and not exists (
    select 1
    from public.profiles as profile
    where profile.id = caller_profile_id
      and profile.role = 'admin'
  ) then
    raise exception 'group creator or app administrator required'
      using errcode = '42501';
  end if;

  update public.conversation_members as member
  set left_at = clock_timestamp()
  where member.conversation_id = p_conversation_id
    and member.profile_id = p_profile_id
    and member.left_at is null;

  if not found then
    raise exception 'conversation member not found'
      using errcode = 'P0002';
  end if;

  perform private.insert_system_message(
    p_conversation_id, 'member_removed', array[caller_profile_id, p_profile_id]
  );
end;
$function$;

REVOKE ALL ON FUNCTION "public"."remove_conversation_member"(uuid, bigint) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.remove_message_attachment (
  p_attachment_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_message private.messages;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  select message.*
  into target_message
  from private.message_attachments as attachment
  join private.messages as message on message.id = attachment.message_id
  where attachment.id = p_attachment_id
    and attachment.status = 'ready'
    and message.sender_id = caller_profile_id
    and message.deleted_at is null
  for update of message;

  if target_message.id is null then
    raise exception 'attachment unavailable'
      using errcode = 'P0002';
  end if;

  update private.message_attachments
  set status = 'deleted'
  where id = p_attachment_id;

  if not exists (
    select 1
    from private.message_attachments as attachment
    where attachment.message_id = target_message.id
      and attachment.status = 'ready'
  ) and private.decrypt_message_text(
    target_message.body_ciphertext, target_message.key_version, private.message_keys()
  ) = '' then
    perform public.delete_messages(array[target_message.id]);
  else
    -- 화면이 바뀐 첨부를 따라잡도록 바뀐 시각을 새로 적는다.
    update private.messages
    set changed_at = clock_timestamp()
    where id = target_message.id;
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."remove_message_attachment"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.rename_conversation (
  p_conversation_id uuid,
  p_name            text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target public.conversations;
  normalized_name text := btrim(coalesce(p_name, ''));
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if char_length(normalized_name) not between 1 and 50 then
    raise exception 'group name must be 1 to 50 characters'
      using errcode = '22023';
  end if;

  target := private.lock_group_for_member(caller_profile_id, p_conversation_id);
  if target.name = normalized_name then
    return;
  end if;

  update public.conversations
  set name = normalized_name
  where id = p_conversation_id;

  perform private.insert_system_message(
    p_conversation_id, 'renamed', array[caller_profile_id], normalized_name
  );
end;
$function$;

REVOKE ALL ON FUNCTION "public"."rename_conversation"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.search_message_recipients (
  p_query text
)
  RETURNS TABLE (
    profile_id   bigint,
    pub_id       text,
    name         text,
    avatar_path  text,
    profile_type public.profile_type,
    cohort       smallint
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  normalized_query text := lower(
    regexp_replace(btrim(coalesce(p_query, '')), '[[:space:]]+', '', 'g')
  );
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if normalized_query = '' then
    return;
  end if;

  return query
  select
    person.id,
    person.pub_id,
    person.name,
    person.avatar_path,
    person.type,
    person.cohort
  from public.profiles as person
  where person.status = 'accepted'
    and person.deleted_at is null
    and person.id <> caller_profile_id
    and person.search_name like '%' || normalized_query || '%'
  order by
    case
      when person.search_name = normalized_query then 0
      when person.search_name like normalized_query || '%' then 1
      else 2
    end,
    person.name,
    person.id
  limit 20;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."search_message_recipients"(text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.search_messages (
  p_conversation_id uuid,
  p_query           text,
  p_before_sent_at  timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_before_id       uuid                     DEFAULT NULL::uuid,
  p_limit           integer                  DEFAULT 20
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  normalized_query text := lower(
    regexp_replace(btrim(coalesce(p_query, '')), '[[:space:]]+', '', 'g')
  );
  result_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  scan_limit constant integer := 1000;
  keys jsonb;
  candidate record;
  plain text;
  scanned integer := 0;
  results jsonb := '[]'::jsonb;
  last_sent_at timestamptz;
  last_id uuid;
  stopped_early boolean := false;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if (p_before_sent_at is null) <> (p_before_id is null) then
    raise exception 'cursor requires both sent_at and id'
      using errcode = '22023';
  end if;
  if normalized_query = '' then
    return jsonb_build_object('results', results, 'next_cursor', null);
  end if;

  keys := private.message_keys();

  for candidate in
    select message.id, message.sender_id, message.sent_at,
      message.body_ciphertext, message.key_version
    from private.messages as message
    where message.conversation_id = p_conversation_id
      and message.deleted_at is null
      and message.system_kind is null
      and (
        p_before_sent_at is null
        or (message.sent_at, message.id) < (p_before_sent_at, p_before_id)
      )
      and exists (
        select 1
        from public.conversation_members as period
        where period.conversation_id = p_conversation_id
          and period.profile_id = caller_profile_id
          and message.sent_at >= period.joined_at
          and (period.left_at is null or message.sent_at < period.left_at)
      )
    order by message.sent_at desc, message.id desc
    limit scan_limit
  loop
    scanned := scanned + 1;
    last_sent_at := candidate.sent_at;
    last_id := candidate.id;
    plain := private.decrypt_message_text(
      candidate.body_ciphertext, candidate.key_version, keys
    );
    if strpos(lower(regexp_replace(plain, '[[:space:]]+', '', 'g')), normalized_query) > 0 then
      results := results || jsonb_build_array(jsonb_build_object(
        'id', candidate.id,
        'sender_id', candidate.sender_id,
        'body', left(plain, 300),
        'sent_at', candidate.sent_at
      ));
      if jsonb_array_length(results) >= result_limit then
        stopped_early := true;
        exit;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'results', results,
    'next_cursor', case
      when stopped_early or scanned = scan_limit
        then jsonb_build_object('sent_at', last_sent_at, 'id', last_id)
    end
  );
end;
$function$;

REVOKE ALL ON FUNCTION "public"."search_messages"(uuid, text, timestamp WITH time zone, uuid, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.send_message (
  p_conversation_id uuid,
  p_message_id      uuid,
  p_body            text,
  p_reply_to_id     uuid DEFAULT NULL::uuid
)
  RETURNS TABLE (
    id      uuid,
    sent_at timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  normalized_body text;
  attachment_count integer;
  encrypted record;
  saved private.messages;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if p_message_id is null then
    raise exception 'message id required'
      using errcode = '22023';
  end if;

  select message.*
  into saved
  from private.messages as message
  where message.id = p_message_id;

  if saved.id is null then
    -- 나가기와 겹치지 않도록 내 현재 참여 기간을 잠근다. 아래에서 같은 행의 읽음 위치를 고치므로
    -- 처음부터 `no key update`로 잡는다. `share`로 잡으면 같은 사람이 동시에 보낸 두 전송이 서로의
    -- 잠금 승격을 기다리며 교착한다.
    perform 1
    from public.conversation_members as member
    where member.conversation_id = p_conversation_id
      and member.profile_id = caller_profile_id
      and member.left_at is null
    for no key update;

    if not found then
      raise exception 'conversation member required'
        using errcode = '42501';
    end if;

    -- 이 메시지로 예고한 첨부의 object를 확인하고 확정한다. 첨부가 있으면 본문은 비어도 된다.
    attachment_count := private.claim_message_attachments(
      caller_profile_id, p_conversation_id, p_message_id
    );
    if attachment_count > 0 then
      if p_reply_to_id is not null then
        raise exception 'attachments cannot be sent as a reply'
          using errcode = '22023';
      end if;
      normalized_body := pg_catalog.regexp_replace(coalesce(p_body, ''), '[\r\n]+$', '');
      if normalized_body !~ '[^[:space:]]' then
        normalized_body := '';
      elsif char_length(normalized_body) > 20000 then
        raise exception 'body must be at most 20000 characters'
          using errcode = '22023';
      end if;
    else
      normalized_body := private.normalize_message_body(p_body);
    end if;

    if p_reply_to_id is not null and not exists (
      select 1
      from private.messages as original
      join public.conversation_members as period
        on period.conversation_id = original.conversation_id
        and period.profile_id = caller_profile_id
        and original.sent_at >= period.joined_at
        and (period.left_at is null or original.sent_at < period.left_at)
      where original.id = p_reply_to_id
        and original.conversation_id = p_conversation_id
        and original.deleted_at is null
        and original.system_kind is null
    ) then
      raise exception 'reply target unavailable'
        using errcode = '22023';
    end if;

    select * into encrypted
    from private.encrypt_message_text(normalized_body, private.message_keys());

    -- 전송 시각은 잠금과 키 읽기를 마친 지금이다. 트랜잭션 시작 시각(`now()`)을 쓰면 늦게 커밋된
    -- 메시지가 이미 읽은 위치보다 앞에 놓여 읽지 않은 수와 페이지 순서에서 빠질 수 있다.
    insert into private.messages (
      id, conversation_id, sender_id, sent_at, reply_to_id, body_ciphertext, key_version
    ) values (
      p_message_id,
      p_conversation_id,
      caller_profile_id,
      clock_timestamp(),
      p_reply_to_id,
      encrypted.ciphertext,
      encrypted.key_version
    )
    on conflict on constraint messages_pkey do nothing
    returning * into saved;

    if saved.id is not null then
      perform private.enqueue_message_push(saved);

      update public.conversation_members as member
      set last_read_sent_at = saved.sent_at,
        last_read_message_id = saved.id
      where member.conversation_id = p_conversation_id
        and member.profile_id = caller_profile_id
        and member.left_at is null
        and (member.last_read_sent_at, member.last_read_message_id) < (saved.sent_at, saved.id);
    else
      -- 같은 ID를 동시에 보낸 다른 요청이 먼저 저장했다.
      select message.*
      into saved
      from private.messages as message
      where message.id = p_message_id;
    end if;
  end if;

  if saved.sender_id is distinct from caller_profile_id
    or saved.conversation_id <> p_conversation_id then
    raise exception 'message id already used'
      using errcode = '23505';
  end if;

  return query select saved.id, saved.sent_at;
end;
$function$;

ALTER TABLE "private"."message_attachments"
  ADD CONSTRAINT "message_attachments_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE "private"."message_attachments"
  ADD CONSTRAINT "message_attachments_uploader_id_fkey" FOREIGN KEY (uploader_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "private"."messages"
  ADD CONSTRAINT "messages_body_check" CHECK ((((body_ciphertext IS NULL) = (key_version IS NULL)) AND (((system_kind IS NULL) AND ((deleted_at IS NULL) = (body_ciphertext IS
    NOT NULL))) OR ((system_kind IS NOT NULL) AND (body_ciphertext IS NULL) AND (deleted_at IS NULL)))));

ALTER TABLE "private"."messages"
  ADD CONSTRAINT "messages_system_check"
    CHECK
    ((((system_kind IS NULL) AND (system_profile_ids IS NULL) AND (system_name IS NULL)) OR ((system_kind = ANY (ARRAY['member_added'::text, 'member_left'::text,
    'member_removed'::text, 'renamed'::text])) AND (sender_id IS NULL) AND (reply_to_id IS NULL) AND ((system_kind = 'renamed'::text) = (system_name IS NOT NULL)))));

ALTER TABLE "private"."storage_cleanup_queue"
  ADD CONSTRAINT "storage_cleanup_queue_reason_check"
    CHECK
    ((reason = ANY (ARRAY['post_attachment'::text, 'comment_image'::text, 'group_media'::text, 'profile_media'::text, 'profile_media_activity'::text, 'story_media'::text,
    'message_attachment'::text, 'unreferenced_sweep'::text])));

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
  WHERE (attachment.thumbnail_path IS NOT NULL);

CREATE INDEX message_attachments_conversation_idx ON private.message_attachments USING btree (conversation_id, created_at DESC)
  WHERE (status = 'ready'::text);

CREATE INDEX message_attachments_message_idx ON private.message_attachments USING btree (message_id);

CREATE UNIQUE INDEX message_attachments_position_key ON private.message_attachments USING btree (message_id, "position")
  WHERE (status <> 'deleted'::text);

CREATE POLICY "message_attachments_deny_direct_access" ON "private"."message_attachments"
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

CREATE POLICY "message_attachments_storage_insert_pending_uploader" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((bucket_id = 'message-attachments'::text) AND (owner_id = ( SELECT (auth.uid())::text AS uid)) AND private.can_upload_message_object(name)));

CREATE POLICY "message_attachments_storage_select_member" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING
    (((bucket_id = 'message-attachments'::text) AND storage.allow_any_operation(ARRAY['object.get_authenticated_info'::text, 'object.get_authenticated'::text, 'object.sign'::text,
    'object.sign_many'::text]) AND private.can_read_message_object(name)));

REVOKE ALL ON FUNCTION "private"."can_read_message_object"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."can_read_message_object"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."can_upload_message_object"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."can_upload_message_object"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."claim_message_attachments"(bigint, uuid, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."conversation_member_limit"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."insert_system_message"(uuid, text, bigint[], text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."lock_group_for_member"(bigint, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."message_rows"(bigint, uuid, uuid[], jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."add_conversation_members"(uuid, bigint[]) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."create_group_conversation"(text, bigint[]) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."get_conversation_attachment_counts"(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."get_my_unread_message_count"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."leave_conversation"(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_conversation_attachments"(uuid, boolean, timestamp WITH time zone, uuid, integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_conversations"(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_message_changes"(uuid, timestamp WITH time zone, integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_message_reactors"(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_pinned_messages"(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."open_direct_conversation"(bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."prepare_message_attachments"(uuid, uuid, jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."remove_conversation_member"(uuid, bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."remove_message_attachment"(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."rename_conversation"(uuid, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."search_message_recipients"(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."search_messages"(uuid, text, timestamp WITH time zone, uuid, integer) TO "authenticated";
