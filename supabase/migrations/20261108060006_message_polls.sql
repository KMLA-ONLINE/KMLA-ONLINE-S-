SET local check_function_bodies = off;

DROP FUNCTION "private"."message_rows"(bigint, uuid, uuid[], jsonb);

DROP FUNCTION "public"."list_conversations"(uuid);

DROP FUNCTION "public"."list_message_changes"(uuid, timestamp WITH time zone, integer);

DROP FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer);

DROP FUNCTION "public"."list_pinned_messages"(uuid);

CREATE TABLE "private"."message_poll_options" (
  "id"               uuid     NOT NULL DEFAULT gen_random_uuid(),
  "message_id"       uuid     NOT NULL,
  "position"         smallint NOT NULL,
  "label_ciphertext" bytea    NOT NULL,
  "key_version"      smallint NOT NULL,
  CONSTRAINT "message_poll_options_pkey" PRIMARY KEY (id),
  CONSTRAINT "message_poll_options_position_check" CHECK ((("position" >= 1) AND ("position" <= 10))),
  CONSTRAINT "message_poll_options_position_key" UNIQUE (message_id, "position")
);

ALTER TABLE "private"."message_poll_options"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."message_poll_votes" (
  "option_id"  uuid                     NOT NULL,
  "message_id" uuid                     NOT NULL,
  "profile_id" bigint                   NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "message_poll_votes_pkey" PRIMARY KEY (option_id, profile_id)
);

ALTER TABLE "private"."message_poll_votes"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."message_polls" (
  "message_id"      uuid                     NOT NULL,
  "conversation_id" uuid                     NOT NULL,
  "multiple"        boolean                  NOT NULL DEFAULT false,
  "closed_at"       timestamp with time zone,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "message_polls_pkey" PRIMARY KEY (message_id)
);

ALTER TABLE "private"."message_polls"
  ENABLE ROW LEVEL SECURITY;

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
        -- 삭제 Push가 카드를 고쳐 쓸 때 대신 보일 메시지가 없으면 이 문구로 덮는다(§11.5).
        when message.deleted_at is not null then '삭제된 메시지입니다.'
        when coalesce(preference.message_preview_hidden, false) then '새 메시지가 있습니다.'
        -- 투표는 질문 앞에 종류를 붙인다(기능 명세 §13.30).
        when exists (select 1 from private.message_polls as poll where poll.message_id = message.id)
          then '투표: ' || private.message_plain_text(
            private.decrypt_message_text(message.body_ciphertext, message.key_version, p_keys)
          )
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
  where message.id = p_message_id;
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
    mentions_everyone     boolean,
    poll                  jsonb
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
        then (
          -- 투표 원문은 질문 앞에 `투표: `를 붙여 부른다(기능 명세 §13.30).
          case when exists (
            select 1 from private.message_polls as reply_poll where reply_poll.message_id = original.id
          ) then '투표: ' else '' end
        ) || left(
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
    message.mentions_everyone,
    poll.value
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
  left join lateral (
    select jsonb_build_object(
      'multiple', poll_row.multiple,
      'closed_at', poll_row.closed_at,
      'options', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', option.id,
            'position', option.position,
            'label', private.decrypt_message_text(option.label_ciphertext, option.key_version, p_keys),
            'count', (
              select count(*) from private.message_poll_votes as vote where vote.option_id = option.id
            ),
            'voter_ids', coalesce((
              select jsonb_agg(vote.profile_id order by vote.created_at)
              from private.message_poll_votes as vote
              where vote.option_id = option.id
            ), '[]'::jsonb)
          )
          order by option.position
        )
        from private.message_poll_options as option
        where option.message_id = poll_row.message_id
      ), '[]'::jsonb),
      'my_option_ids', coalesce((
        select jsonb_agg(vote.option_id)
        from private.message_poll_votes as vote
        where vote.message_id = poll_row.message_id
          and vote.profile_id = p_caller_profile_id
      ), '[]'::jsonb)
    ) as value
    from private.message_polls as poll_row
    where poll_row.message_id = message.id
      and message.deleted_at is null
  ) as poll on true
  where message.conversation_id = p_conversation_id
    and message.id = any(p_message_ids)
  order by message.sent_at, message.id;
$function$;

CREATE OR REPLACE FUNCTION public.close_message_poll (
  p_message_id uuid
)
  RETURNS timestamp WITH time zone
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target private.messages;
  closed timestamptz;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  target := private.lock_actionable_message(caller_profile_id, p_message_id);
  if target.sender_id is distinct from caller_profile_id then
    raise exception 'poll author required'
      using errcode = '42501';
  end if;

  update private.message_polls as poll
  set closed_at = coalesce(poll.closed_at, clock_timestamp())
  where poll.message_id = target.id
  returning poll.closed_at into closed;
  if closed is null then
    raise exception 'poll required'
      using errcode = 'P0002';
  end if;
  return closed;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."close_message_poll"(uuid) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.create_message_poll (
  p_conversation_id uuid,
  p_message_id      uuid,
  p_question        text,
  p_options         text[],
  p_multiple        boolean DEFAULT false
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
  normalized_question text := btrim(coalesce(p_question, ''));
  labels text[];
  keys jsonb;
  encrypted record;
  saved record;
  label text;
  position_index integer := 0;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if p_message_id is null then
    raise exception 'message id required'
      using errcode = '22023';
  end if;
  perform private.lock_group_for_member(caller_profile_id, p_conversation_id);

  if char_length(normalized_question) not between 1 and 200 then
    raise exception 'poll question must be 1 to 200 characters'
      using errcode = '22023';
  end if;
  select array_agg(btrim(entry))
  into labels
  from unnest(coalesce(p_options, '{}'::text[])) as entry
  where btrim(coalesce(entry, '')) <> '';
  if coalesce(cardinality(labels), 0) not between 2 and 10 then
    raise exception 'poll needs 2 to 10 options'
      using errcode = '22023';
  end if;
  if exists (select 1 from unnest(labels) as entry where char_length(entry) > 100) then
    raise exception 'poll option must be at most 100 characters'
      using errcode = '22023';
  end if;
  if (select count(distinct entry) from unnest(labels) as entry) <> cardinality(labels) then
    raise exception 'poll options must be distinct'
      using errcode = '22023';
  end if;

  -- 같은 ID로 다시 보낸 요청은 이미 만든 투표를 돌려준다. 전송처럼 멱등이다.
  if exists (select 1 from private.messages as message where message.id = p_message_id) then
    return query
      select message.id, message.sent_at
      from private.messages as message
      where message.id = p_message_id;
    return;
  end if;

  select * into saved
  from public.send_message(p_conversation_id, p_message_id, normalized_question);

  keys := private.message_keys();
  insert into private.message_polls (message_id, conversation_id, multiple)
  values (p_message_id, p_conversation_id, coalesce(p_multiple, false));

  foreach label in array labels loop
    position_index := position_index + 1;
    select * into encrypted from private.encrypt_message_text(label, keys);
    insert into private.message_poll_options (message_id, position, label_ciphertext, key_version)
    values (p_message_id, position_index, encrypted.ciphertext, encrypted.key_version);
  end loop;

  return query select saved.id, saved.sent_at;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."create_message_poll"(uuid, uuid, text, text[], boolean) FROM PUBLIC, "anon", "service_role";

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

  -- 투표는 선택지·표와 함께 지운다. 메시지 행은 남아 답장 인용을 받친다(기능 명세 §13.30).
  delete from private.message_polls as poll
  where poll.message_id = any(p_message_ids);

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
    key_version = null,
    mention_profile_ids = '{}',
    mentions_everyone = false
  where message.id = any(p_message_ids)
    and message.deleted_at is null;

  perform private.enqueue_message_deleted_push(p_message_ids);
end;
$function$;

CREATE OR REPLACE FUNCTION public.edit_message (
  p_message_id      uuid,
  p_body            text,
  p_mention_pub_ids text[] DEFAULT NULL::text[]
)
  RETURNS timestamp WITH time zone
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  normalized_body text := private.normalize_message_body(p_body);
  target private.messages;
  saved private.messages;
  resolved_mentions bigint[];
  newly_mentioned bigint[];
  encrypted record;
  edited timestamptz;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  target := private.lock_actionable_message(caller_profile_id, p_message_id);
  edited := clock_timestamp();

  if target.sender_id is distinct from caller_profile_id then
    raise exception 'message sender required'
      using errcode = '42501';
  end if;
  if exists (select 1 from private.message_polls as poll where poll.message_id = target.id) then
    raise exception 'poll messages cannot be edited'
      using errcode = '55000';
  end if;
  if edited > target.sent_at + interval '15 minutes' then
    raise exception 'edit window has passed'
      using errcode = '22023';
  end if;

  -- 단계를 모르는 이전 버전 화면은 공개 ID를 보내지 않고 토큰을 그대로 둔 채 고친다. 그때는 같은 번호가
  -- 같은 사람을 부르던 그대로 둔다.
  resolved_mentions := private.resolve_message_mentions(
    target.conversation_id,
    normalized_body,
    coalesce(
      p_mention_pub_ids,
      array(
        select profile.pub_id
        from unnest(target.mention_profile_ids) with ordinality as entry(profile_id, ordinal)
        left join public.profiles as profile on profile.id = entry.profile_id
        order by entry.ordinal
      )
    ),
    target.mention_profile_ids,
    target.sent_at
  );

  select * into encrypted
  from private.encrypt_message_text(normalized_body, private.message_keys());

  update private.messages as message
  set body_ciphertext = encrypted.ciphertext,
    key_version = encrypted.key_version,
    edited_at = edited,
    mention_profile_ids = resolved_mentions,
    mentions_everyone = 0 = any(private.parse_mention_ordinals(normalized_body))
  where message.id = target.id
  returning message.* into saved;

  -- 이미 불려 있던 사람에게는 다시 보내지 않는다. `@모든 사람`이 새로 생기면 모두가 새로 불린 것이다.
  -- 같은 메시지와 구독의 delivery는 하나뿐이라 이미 예약된 구독은 건너뛴다.
  if saved.mentions_everyone and not target.mentions_everyone then
    perform private.enqueue_message_push(saved);
  else
    newly_mentioned := array(
      select unnest(saved.mention_profile_ids)
      except
      select unnest(target.mention_profile_ids)
    );
    if cardinality(newly_mentioned) > 0 then
      perform private.enqueue_message_push(saved, newly_mentioned);
    end if;
  end if;

  return edited;
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
    hidden                       boolean,
    last_message_poll            boolean
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
    exists (
      select 1 from private.message_polls as poll where poll.message_id = last_message.id
    )
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

REVOKE ALL ON FUNCTION "public"."list_conversations"(uuid) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.list_message_changes (
  p_conversation_id uuid,
  p_since           timestamp with time zone,
  p_limit           integer                  DEFAULT 100
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
    mentions_everyone     boolean,
    poll                  jsonb
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

REVOKE ALL ON FUNCTION "public"."list_message_changes"(uuid, timestamp WITH time zone, integer) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.list_messages (
  p_conversation_id uuid,
  p_before_sent_at  timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_before_id       uuid                     DEFAULT NULL::uuid,
  p_limit           integer                  DEFAULT 50
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
    mentions_everyone     boolean,
    poll                  jsonb
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

REVOKE ALL ON FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.list_pinned_messages (
  p_conversation_id uuid
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
    mentions_everyone     boolean,
    poll                  jsonb
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

REVOKE ALL ON FUNCTION "public"."list_pinned_messages"(uuid) FROM PUBLIC, "anon", "service_role";

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
      message.body_ciphertext, message.key_version, message.mention_profile_ids
    from private.messages as message
    where message.conversation_id = p_conversation_id
      and message.deleted_at is null
      and message.system_kind is null
      -- 투표 질문은 검색하지 않는다(기능 명세 §13.30).
      and not exists (select 1 from private.message_polls as poll where poll.message_id = message.id)
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
    -- 멘션은 화면에 보이는 `@이름`으로 찾는다. 토큰의 `m:1`이 검색어에 걸리지 않게 한다.
    plain := private.message_plain_text(
      private.decrypt_message_text(candidate.body_ciphertext, candidate.key_version, keys)
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

CREATE OR REPLACE FUNCTION public.vote_message_poll (
  p_message_id uuid,
  p_option_ids uuid[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target private.messages;
  poll private.message_polls;
  chosen uuid[];
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  target := private.lock_actionable_message(caller_profile_id, p_message_id);

  select item.* into poll
  from private.message_polls as item
  where item.message_id = target.id
  for update;
  if poll.message_id is null then
    raise exception 'poll required'
      using errcode = 'P0002';
  end if;
  if poll.closed_at is not null then
    raise exception 'poll closed'
      using errcode = '55000';
  end if;

  select coalesce(array_agg(distinct entry), '{}'::uuid[])
  into chosen
  from unnest(coalesce(p_option_ids, '{}'::uuid[])) as entry;
  if not poll.multiple and cardinality(chosen) > 1 then
    raise exception 'poll allows one option'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(chosen) as entry
    where not exists (
      select 1
      from private.message_poll_options as option
      where option.id = entry
        and option.message_id = poll.message_id
    )
  ) then
    raise exception 'poll option unavailable'
      using errcode = '22023';
  end if;

  delete from private.message_poll_votes as vote
  where vote.message_id = poll.message_id
    and vote.profile_id = caller_profile_id;

  insert into private.message_poll_votes (option_id, message_id, profile_id)
  select entry, poll.message_id, caller_profile_id
  from unnest(chosen) as entry;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."vote_message_poll"(uuid, uuid[]) FROM PUBLIC, "anon", "service_role";

ALTER TABLE "private"."message_poll_votes"
  ADD CONSTRAINT "message_poll_votes_option_id_fkey" FOREIGN KEY (option_id) REFERENCES private.message_poll_options(id) ON DELETE CASCADE;

ALTER TABLE "private"."message_poll_votes"
  ADD CONSTRAINT "message_poll_votes_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "private"."message_polls"
  ADD CONSTRAINT "message_polls_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE "private"."message_polls"
  ADD CONSTRAINT "message_polls_message_id_fkey" FOREIGN KEY (message_id) REFERENCES private.messages(id) ON DELETE CASCADE;

ALTER TABLE "private"."message_poll_options"
  ADD CONSTRAINT "message_poll_options_message_id_fkey" FOREIGN KEY (message_id) REFERENCES private.message_polls(message_id) ON DELETE CASCADE;

ALTER TABLE "private"."message_poll_votes"
  ADD CONSTRAINT "message_poll_votes_message_id_fkey" FOREIGN KEY (message_id) REFERENCES private.message_polls(message_id) ON DELETE CASCADE;

CREATE INDEX message_poll_votes_message_idx ON private.message_poll_votes USING btree (message_id, profile_id);

CREATE TRIGGER message_poll_votes_touch
  AFTER INSERT OR DELETE OR UPDATE ON private.message_poll_votes
  FOR EACH ROW
  EXECUTE FUNCTION private.touch_message_from_child();

CREATE TRIGGER message_polls_touch
  AFTER UPDATE ON private.message_polls
  FOR EACH ROW
  EXECUTE FUNCTION private.touch_message_from_child();

CREATE POLICY "message_poll_options_deny_direct_access" ON "private"."message_poll_options"
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

CREATE POLICY "message_poll_votes_deny_direct_access" ON "private"."message_poll_votes"
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

CREATE POLICY "message_polls_deny_direct_access" ON "private"."message_polls"
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON FUNCTION "private"."message_rows"(bigint, uuid, uuid[], jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."close_message_poll"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."close_message_poll"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."close_message_poll"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_message_poll"(uuid, uuid, text, text[], boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."create_message_poll"(uuid, uuid, text, text[], boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_message_poll"(uuid, uuid, text, text[], boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_conversations"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_conversations"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_conversations"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_message_changes"(uuid, timestamp WITH time zone, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_message_changes"(uuid, timestamp WITH time zone, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_message_changes"(uuid, timestamp WITH time zone, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_pinned_messages"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_pinned_messages"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_pinned_messages"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."vote_message_poll"(uuid, uuid[]) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."vote_message_poll"(uuid, uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."vote_message_poll"(uuid, uuid[]) TO "postgres";
