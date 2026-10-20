SET local check_function_bodies = off;

ALTER TABLE "public"."profiles"
  DROP CONSTRAINT "profiles_type_details";

CREATE OR REPLACE FUNCTION private.direct_counterpart_withdrawn (
  p_conversation_id   uuid,
  p_caller_profile_id bigint
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.conversations as conversation
    join public.profiles as partner
      on partner.id in (conversation.direct_profile_low, conversation.direct_profile_high)
      and partner.id <> p_caller_profile_id
    where conversation.id = p_conversation_id
      and conversation.type = 'direct'
      and partner.deleted_at is not null
  );
$function$;

CREATE OR REPLACE FUNCTION private.emit_notification (
  p_event_key            text,
  p_recipient_profile_id bigint,
  p_kind                 public.notification_kind,
  p_importance           public.notification_importance,
  p_category             public.notification_category,
  p_actor_identity       public.notification_actor_identity,
  p_actor_profile_id     bigint,
  p_actor_display_name   text,
  p_actor_avatar_path    text,
  p_title                text,
  p_group_id             uuid                               DEFAULT NULL::uuid,
  p_post_id              uuid                               DEFAULT NULL::uuid,
  p_comment_id           uuid                               DEFAULT NULL::uuid,
  p_target_profile_id    bigint                             DEFAULT NULL::bigint,
  p_reservation_id       bigint                             DEFAULT NULL::bigint,
  p_aggregate_key        text                               DEFAULT NULL::text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  created_notification_id uuid;
begin
  if p_recipient_profile_id is null
    or p_event_key is null
    or p_actor_profile_id = p_recipient_profile_id then
    return null;
  end if;

  if p_group_id is not null and p_category = 'content' and exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = p_group_id
      and membership.profile_id = p_recipient_profile_id
      and membership.notification_level = 'none'
  ) then
    return null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(coalesce(p_aggregate_key, p_event_key), 0)
  );

  insert into private.notification_event_keys (event_key)
  values (p_event_key)
  on conflict do nothing;
  if not found then
    select event.notification_id into created_notification_id
    from private.notification_event_keys as event
    where event.event_key = p_event_key;
    return created_notification_id;
  end if;

  -- 정지 기간에 생긴 알림은 만들지 않고 해제 뒤에도 보내지 않는다(§14.12). event key는 남겨, 멘션을
  -- 고쳐 다시 넣는 것처럼 같은 사건이 해제 뒤 다시 들어와도 새 알림이 되지 않게 한다.
  if private.profile_suspended(p_recipient_profile_id) then
    return null;
  end if;

  if exists (
    select 1
    from public.profiles as recipient
    where recipient.id = p_recipient_profile_id
      and recipient.deleted_at is not null
  ) then
    return null;
  end if;

  if p_aggregate_key is not null then
    select event.notification_id into created_notification_id
    from private.notification_event_keys as event
    where event.event_key = p_aggregate_key
    for update;
  end if;

  if created_notification_id is not null then
    update public.notifications
    set actor_identity = p_actor_identity,
      actor_profile_id = case when p_actor_identity = 'identified' then p_actor_profile_id end,
      actor_display_name = p_actor_display_name,
      actor_avatar_path = p_actor_avatar_path,
      actor_count = actor_count + 1,
      -- now()는 트랜잭션 시작 시각이다. 먼저 시작해 늦게 모인 활동이 시각을 되돌리거나 created_at보다
      -- 이르게 만들지 않게 한다.
      last_activity_at = greatest(last_activity_at, now()),
      read_at = null
    where id = created_notification_id;

    -- 집계된 활동도 Push는 따로 보낸다. 반응처럼 Push를 지원하지 않는 종류는 허용 검사에서 빠진다.
    perform private.enqueue_notification_push(created_notification_id, p_event_key);
  else
    insert into public.notifications (
      recipient_profile_id, kind, importance, category, actor_identity,
      actor_profile_id, actor_display_name, actor_avatar_path, group_id, post_id,
      comment_id, target_profile_id, reservation_id, title
    ) values (
      p_recipient_profile_id, p_kind, p_importance, p_category, p_actor_identity,
      case when p_actor_identity = 'identified' then p_actor_profile_id end,
      p_actor_display_name, p_actor_avatar_path, p_group_id, p_post_id,
      p_comment_id, p_target_profile_id, p_reservation_id, btrim(p_title)
    ) returning id into created_notification_id;

    if p_aggregate_key is not null then
      insert into private.notification_event_keys (event_key, notification_id)
      values (p_aggregate_key, created_notification_id)
      on conflict (event_key) do update set notification_id = excluded.notification_id;
    end if;

    perform private.enqueue_notification_push(created_notification_id, p_event_key);
  end if;

  update private.notification_event_keys as event
  set notification_id = created_notification_id
  where event.event_key = p_event_key;

  return created_notification_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.leave_group_conversation (
  p_profile_id      bigint,
  p_conversation_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  update public.conversation_members as member
  set left_at = clock_timestamp(),
    left_by_self = true
  where member.conversation_id = p_conversation_id
    and member.profile_id = p_profile_id
    and member.left_at is null;

  -- 소유주가 나가면 가장 먼저 들어온 남은 멤버가 소유주가 된다. 아무도 없으면 비운다.
  update public.conversations as conversation
  set created_by = (
    select member.profile_id
    from public.conversation_members as member
    where member.conversation_id = p_conversation_id
      and member.left_at is null
    order by member.joined_at, member.id
    limit 1
  )
  where conversation.id = p_conversation_id
    and conversation.created_by = p_profile_id;

  perform private.insert_system_message(
    p_conversation_id, 'member_left', array[p_profile_id]
  );
end;
$function$;

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
  perform private.leave_group_conversation(caller_profile_id, p_conversation_id);
end;
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
          ),
          last_message.mention_profile_ids
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
        and attachment.status = 'ready'
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
  if private.direct_counterpart_withdrawn(p_conversation_id, caller_profile_id) then
    raise exception 'recipient withdrawn'
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

CREATE OR REPLACE FUNCTION public.send_message (
  p_conversation_id uuid,
  p_message_id      uuid,
  p_body            text,
  p_reply_to_id     uuid    DEFAULT NULL::uuid,
  p_mark_read       boolean DEFAULT true,
  p_mention_pub_ids text[]  DEFAULT NULL::text[]
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
  resolved_mentions bigint[];
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

    if private.direct_counterpart_withdrawn(p_conversation_id, caller_profile_id) then
      raise exception 'recipient withdrawn'
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

    resolved_mentions := private.resolve_message_mentions(
      p_conversation_id, normalized_body, p_mention_pub_ids
    );

    select * into encrypted
    from private.encrypt_message_text(normalized_body, private.message_keys());

    -- 전송 시각은 잠금과 키 읽기를 마친 지금이다. 트랜잭션 시작 시각(`now()`)을 쓰면 늦게 커밋된
    -- 메시지가 이미 읽은 위치보다 앞에 놓여 읽지 않은 수와 페이지 순서에서 빠질 수 있다.
    insert into private.messages (
      id, conversation_id, sender_id, sent_at, reply_to_id, body_ciphertext, key_version,
      mention_profile_ids, mentions_everyone
    ) values (
      p_message_id,
      p_conversation_id,
      caller_profile_id,
      clock_timestamp(),
      p_reply_to_id,
      encrypted.ciphertext,
      encrypted.key_version,
      resolved_mentions,
      0 = any(private.parse_mention_ordinals(normalized_body))
    )
    on conflict on constraint messages_pkey do nothing
    returning * into saved;

    if saved.id is not null then
      perform private.enqueue_message_push(saved);

      if p_mark_read then
        update public.conversation_members as member
        set last_read_sent_at = saved.sent_at,
          last_read_message_id = saved.id
        where member.conversation_id = p_conversation_id
          and member.profile_id = caller_profile_id
          and member.left_at is null
          and (member.last_read_sent_at, member.last_read_message_id) < (saved.sent_at, saved.id);
      end if;
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

CREATE OR REPLACE FUNCTION public.withdraw_account()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_auth_user_id uuid := auth.uid();
  caller public.profiles;
  conversation_id uuid;
  timeline_post_ids uuid[];
begin
  select profile.* into caller
  from public.profiles as profile
  where profile.auth_user_id = caller_auth_user_id
    and caller_auth_user_id is not null
    and profile.status = 'accepted'
    and profile.deleted_at is null
  for update;

  if caller.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  perform private.require_recent_password_auth();

  -- 소유권 이전(`transfer_group_ownership`)도 대상 멤버십을 잠근다. 검사 전에 먼저 잠가야, 동시에
  -- 넘겨받은 소유자 행을 아래에서 지워 소유자 없는 그룹을 만드는 일이 없다.
  perform 1
  from public.group_memberships as membership
  where membership.profile_id = caller.id
  for update;

  if caller.role = 'admin' then
    raise exception 'app administrator role must be released before withdrawal'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.group_memberships as membership
    where membership.profile_id = caller.id
      and membership.role = 'owner'
  ) then
    raise exception 'group ownership must be transferred before withdrawal'
      using errcode = '22023';
  end if;

  -- 1:1 대화는 상대의 기록으로 남기되 내 참여 기간만 닫는다. 열어 두면 상대 메시지의 안 읽은
  -- 수에 탈퇴자가 영원히 남는다. 새 메시지는 `send_message`가 거부한다.
  update public.conversation_members as member
  set left_at = clock_timestamp(),
    left_by_self = true
  from public.conversations as conversation
  where conversation.id = member.conversation_id
    and conversation.type = 'direct'
    and member.profile_id = caller.id
    and member.left_at is null;

  -- 그룹 대화는 나가며 남은 멤버에게 나갔다는 표시를 남긴다.
  for conversation_id in
    select member.conversation_id
    from public.conversation_members as member
    join public.conversations as conversation on conversation.id = member.conversation_id
    where member.profile_id = caller.id
      and member.left_at is null
      and conversation.type = 'group'
    order by member.conversation_id
  loop
    perform private.lock_group_for_member(caller.id, conversation_id);
    perform private.leave_group_conversation(caller.id, conversation_id);
  end loop;

  -- 타임라인 주인이 탈퇴하면 그 타임라인의 글은 아무도 읽을 수 없으므로 남의 글까지 함께 지운다.
  select coalesce(array_agg(post.id), '{}') into timeline_post_ids
  from public.posts as post
  where post.timeline_profile_id = caller.id;
  perform private.purge_posts(timeline_post_ids);

  with deleted as (
    delete from public.stories as story
    where story.profile_id = caller.id
    returning story.image_path, story.thumbnail_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'story-media', path.object_path, 'story_media'
  from deleted
  cross join lateral (values (deleted.image_path), (deleted.thumbnail_path)) as path(object_path)
  where path.object_path is not null
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;

  with deleted as (
    delete from public.profile_media_objects as media
    where media.profile_id = caller.id
    returning media.object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'profile-media', deleted.object_path, 'profile_media'
  from deleted
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;

  with deleted as (
    delete from public.profile_media_activity_objects as activity
    where activity.profile_id = caller.id
    returning activity.object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'profile-media', deleted.object_path, 'profile_media_activity'
  from deleted
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;

  delete from public.group_join_requests where profile_id = caller.id;
  delete from private.group_invites where created_by = caller.id;
  delete from public.user_timetables where profile_id = caller.id;
  delete from public.notification_preferences where profile_id = caller.id;
  delete from private.web_push_subscriptions where profile_id = caller.id;
  delete from private.notification_delivery_outbox where recipient_profile_id = caller.id;
  delete from public.notifications where recipient_profile_id = caller.id;
  delete from public.profile_permissions where profile_id = caller.id;
  delete from private.feed_sessions where profile_id = caller.id;
  delete from public.story_views where profile_id = caller.id;
  -- 지난 예약도 신청자 이름 사본을 들고 있다.
  delete from public.utility_reservations where profile_id = caller.id;
  delete from private.group_post_reports where reporter_profile_id = caller.id;
  delete from private.profile_suspensions where profile_id = caller.id;
  delete from private.group_anonymous_activity_restrictions where profile_id = caller.id;
  -- 진행 중인 회차의 신청만 풀어 다른 사람이 신청할 수 있게 한다. 마감한 회차의 신청은 배부
  -- 기록이므로 건드리지 않는다.
  update public.donation_claims as claim
  set cancelled_at = now()
  from public.donation_items as item
  join public.donation_rounds as round on round.id = item.round_id
  where item.id = claim.item_id
    and claim.profile_id = caller.id
    and claim.cancelled_at is null
    and now() >= round.opens_at
    and now() < round.closes_at;

  -- 다른 회원의 알림에 복사된 이름과 사진. 읽기 경로가 빈 이름을 "탈퇴한 사용자"로 그린다.
  update public.notifications
  set actor_display_name = null, actor_avatar_path = null
  where actor_profile_id = caller.id;

  -- 상태 전환 트리거가 공식 그룹 멤버십을 지우므로 나머지 그룹 멤버십을 그 뒤에 지운다.
  update public.profiles
  set status = 'withdrawn',
    deleted_at = now(),
    -- 사용자가 고른 공개 ID도 식별 정보다. 무작위 값으로 바꿔 묘비와 사람의 연결을 끊는다.
    pub_id = private.generate_profile_pub_id(),
    status_updated_at = now(),
    status_updated_by = caller.id,
    auth_user_id = null,
    role = 'member',
    name = '탈퇴한 사용자',
    anonymous_username = null,
    student_number = null,
    class_no = null,
    cohort = null,
    gender = null,
    academic_track = null,
    phone_number = null,
    avatar_path = null,
    cover_path = null,
    birthday = null,
    description = null,
    dorm_room = null,
    contact_email = null,
    department = null,
    is_returning_student = false
  where id = caller.id;

  delete from public.group_memberships where profile_id = caller.id;

  -- 세션과 identity는 FK CASCADE로 함께 지워진다. 이미 발급된 access token은 만료까지 남지만
  -- 프로필에 이어지지 않아 모든 RLS·RPC 검사에서 거부된다.
  delete from auth.users where id = caller_auth_user_id;

  -- 위에서 큐에 넣은 미디어를 바로 지우도록 워커를 깨운다. `purge_posts`도 깨우지만 그때는 아직
  -- 미디어가 큐에 없다. 실패해도 경로는 큐에 남아 백스톱이 받는다(삭제 및 보존 정책 §4.1).
  perform private.invoke_storage_cleanup(p_quiet => true);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."withdraw_account"() FROM PUBLIC, "anon", "service_role";

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_type_details" CHECK (((status = 'withdrawn'::public.profile_status) OR ((type = 'student'::public.profile_type) AND (student_number IS
    NOT NULL) AND (birthday IS NOT NULL) AND (cohort IS NOT NULL) AND (gender IS NOT NULL) AND (academic_track IS
    NOT NULL)) OR ((type = 'alumni'::public.profile_type) AND (cohort IS NOT NULL) AND (gender IS NOT NULL) AND (academic_track IS
    NOT NULL) AND (class_no IS NULL) AND (dorm_room IS NULL)) OR
    ((type = 'teacher'::public.profile_type) AND (student_number IS NULL) AND (class_no IS NULL) AND (cohort IS NULL) AND (gender IS NULL) AND (academic_track IS NULL) AND
    (dorm_room IS NULL))));

REVOKE ALL ON FUNCTION "private"."direct_counterpart_withdrawn"(uuid, bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."leave_group_conversation"(bigint, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."withdraw_account"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."withdraw_account"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."withdraw_account"() TO "postgres";
