SET local check_function_bodies = off;

ALTER TABLE "private"."message_attachments"
  DROP CONSTRAINT "message_attachments_status_check";

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
    where (
        (
          attachment.status = 'ready'
          and p_object_path in (attachment.object_path, attachment.thumbnail_path)
        )
        -- 보존 기간이 지난 첨부는 첫 프레임만 남는다.
        or (attachment.status = 'expired' and p_object_path = attachment.thumbnail_path)
      )
      and message.deleted_at is null
  );
$function$;

CREATE OR REPLACE FUNCTION private.cleanup_expired_records()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  removed bigint := 0;
  affected bigint;
  korea_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  -- 스토리는 만료되면 읽는 경로가 없다(기능 명세 §17.6). publish하지 못한 사진 스토리는 48시간을
  -- 기다린다. Storage 2층 스윕과 같은 유예라 업로드 중인 행을 지우지 않는다. 행을 지우는 문장이
  -- 이미지 경로를 정리 큐로 옮긴다.
  with expired as (
    delete from public.stories as story
    where (story.status = 'ready' and story.expires_at <= now())
      or (story.status = 'pending' and story.created_at <= now() - interval '48 hours')
    returning story.image_path, story.thumbnail_path
  ), queued as (
    insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
    select 'story-media', path.object_path, 'story_media'
    from expired
    cross join lateral (
      values (expired.image_path), (expired.thumbnail_path)
    ) as path(object_path)
    where path.object_path is not null
    on conflict (bucket, object_path) do update
      set dry_run = queue.dry_run and excluded.dry_run
  )
  select count(*) into affected from expired;
  removed := removed + affected;

  -- 메시지의 사진이 아닌 첨부는 500KB(512000바이트)를 넘으면 1년만 보관한다. 대화 맥락을 위해 행과
  -- 동영상 첫 프레임은 남기고 파일만 큐로 옮긴다. 조건을 바꾸면 `message_attachments_retention_idx`도 바꾼다.
  with expired as (
    update private.message_attachments as attachment
    set status = 'expired'
    where attachment.status = 'ready'
      and attachment.kind <> 'image'
      and attachment.size_bytes > 512000
      and attachment.created_at <= now() - interval '1 year'
    returning attachment.object_path
  ), queued as (
    insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
    select 'message-attachments', expired.object_path, 'message_attachment'
    from expired
    on conflict (bucket, object_path) do update
      set dry_run = queue.dry_run and excluded.dry_run
  )
  select count(*) into affected from expired;
  removed := removed + affected;

  -- 예약은 끝난 뒤 2주까지 남긴다. 반복 예약은 종료일이 정해지기 전까지 지우지 않는다.
  delete from public.utility_reservations as reservation
  where case
      when reservation.recurring then reservation.recurring_until
      else reservation.reservation_date
    end < korea_today - 14;
  get diagnostics affected = row_count;
  removed := removed + affected;

  -- 관리자 반복 선예약도 같다. 첫 날짜가 지나도 반복이 끝나기 전에는 학생 예약을 막고 있다.
  delete from public.gongang_schedule as schedule
  where case
      when schedule.recurring then schedule.recurring_until
      else schedule.schedule_date
    end < korea_today - 14;
  get diagnostics affected = row_count;
  removed := removed + affected;

  -- 랭킹 이벤트는 append-only 라 정리 경로임을 밝혀야 지울 수 있다(삭제 및 보존 정책 §7.4).
  perform pg_catalog.set_config('app.feed_event_purge', 'on', true);

  -- 반응 이벤트는 발행 후 6시간 이내 게시물에만 합산된다. 그보다 오래된 것은 어떤 조회에도 잡히지
  -- 않는다. 경계를 넉넉히 두려고 하루를 남긴다.
  delete from private.post_reaction_count_events
  where occurred_at < now() - interval '24 hours';
  get diagnostics affected = row_count;
  removed := removed + affected;

  -- `#업` 이벤트는 게시물당 가장 최근 하나만 읽는다. 1시간 중복 방지 검사도 최근 구간만 보므로
  -- 최신 한 건을 남기면 두 조회가 모두 그대로 동작한다. 나머지는 죽은 데이터다.
  delete from private.feed_bump_events as bump
  where exists (
    select 1
    from private.feed_bump_events as newer
    where newer.post_id = bump.post_id
      and (newer.effective_at, newer.id) > (bump.effective_at, bump.id)
  );
  get diagnostics affected = row_count;
  removed := removed + affected;

  perform pg_catalog.set_config('app.feed_event_purge', 'off', true);

  return removed;
end;
$function$;

CREATE OR REPLACE FUNCTION private.message_rows (
  p_caller_profile_id bigint,
  p_conversation_id   uuid,
  p_message_ids       uuid[],
  p_keys              jsonb
)
  RETURNS TABLE (
    id                    uuid,
    sender_id             bigint,
    body                  text,
    sent_at               timestamp with time zone,
    edited_at             timestamp with time zone,
    deleted               boolean,
    reply_to_id           uuid,
    reply_sender_id       bigint,
    reply_body            text,
    reply_deleted         boolean,
    reply_attachment_kind text,
    unread_member_count   integer,
    reactions             jsonb,
    my_reaction           public.post_reaction,
    pinned                boolean,
    changed_at            timestamp with time zone,
    system_kind           text,
    system_profile_ids    bigint[],
    system_name           text,
    attachments           jsonb,
    mention_profile_ids   bigint[],
    mentions_everyone     boolean
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
          private.message_plain_text(
            private.decrypt_message_text(original.body_ciphertext, original.key_version, p_keys)
          ),
          200
        )
      when original.id is not null then ''
    end,
    original.deleted_at is not null,
    case
      when original.id is not null and original.deleted_at is null then (
        select attachment.kind
        from private.message_attachments as attachment
        where attachment.message_id = original.id
          and attachment.status in ('ready', 'expired')
        order by attachment.position
        limit 1
      )
    end,
    case
      when message.system_kind is null then (
        select count(*)::integer
        from public.conversation_members as other
        where other.conversation_id = p_conversation_id
          and other.profile_id <> p_caller_profile_id
          and other.profile_id is distinct from message.sender_id
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
    coalesce(files.list, '[]'::jsonb),
    message.mention_profile_ids,
    message.mentions_everyone
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
        'expired', attachment.status = 'expired',
        'file_name', private.decrypt_message_text(
          attachment.filename_ciphertext, attachment.key_version, p_keys
        )
      )
      order by attachment.position
    ) as list
    from private.message_attachments as attachment
    where attachment.message_id = message.id
      and attachment.conversation_id = message.conversation_id
      and attachment.status in ('ready', 'expired')
  ) as files on true
  where message.conversation_id = p_conversation_id
    and message.id = any(p_message_ids)
  order by message.sent_at, message.id;
$function$;

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
    hidden                       boolean
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
      and coalesce(last_message.sent_at <= latest_period.hidden_at, true)
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
  order by last_message.sent_at desc nulls last, conversation.created_at desc, conversation.id;
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
            ~ '\.(gif|mp4|m4v|mov|webm|mkv|avi|wmv|flv|3gp|3g2|mpe?g|ogv|m2ts)$'
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
     or lower(btrim(p_original_filename)) ~ '\.(gif|mp4|m4v|mov|webm|mkv|avi|wmv|flv|3gp|3g2|mpe?g|ogv|m2ts)$' then
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

ALTER TABLE "private"."message_attachments"
  ADD CONSTRAINT "message_attachments_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'ready'::text, 'expired'::text, 'deleted'::text])));

CREATE INDEX message_attachments_retention_idx ON private.message_attachments USING btree (created_at)
  WHERE ((status = 'ready'::text) AND (kind <> 'image'::text) AND (size_bytes > 512000));
