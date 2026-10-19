SET local check_function_bodies = off;

DROP FUNCTION "private"."enqueue_message_push"(private.messages);

DROP FUNCTION "private"."message_rows"(bigint, uuid, uuid[], jsonb);

DROP FUNCTION "public"."edit_message"(uuid, text);

DROP FUNCTION "public"."list_conversations"(uuid);

DROP FUNCTION "public"."list_message_changes"(uuid, timestamp WITH time zone, integer);

DROP FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer);

DROP FUNCTION "public"."list_pinned_messages"(uuid);

DROP FUNCTION "public"."send_message"(uuid, uuid, text, uuid, boolean);

ALTER TABLE "private"."messages"
  ADD COLUMN "mention_profile_ids" bigint[] NOT NULL DEFAULT '{}'::bigint[];

ALTER TABLE "private"."messages"
  ADD COLUMN "mentions_everyone" boolean NOT NULL DEFAULT false;

ALTER TABLE "public"."conversation_members"
  ADD COLUMN "mentions_only" boolean NOT NULL DEFAULT false;

CREATE TYPE "public"."conversation_notification_level" AS ENUM (
  'all',
  'mentions',
  'off'
);

CREATE OR REPLACE FUNCTION private.enqueue_message_push (
  p_message     private.messages,
  p_profile_ids bigint[]         DEFAULT NULL::bigint[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  insert into private.notification_delivery_outbox (
    message_id, recipient_profile_id, subscription_id, channel, available_at
  )
  select
    p_message.id,
    member.profile_id,
    subscription.id,
    'web_push',
    p_message.sent_at + interval '2 seconds'
  from public.conversation_members as member
  join private.web_push_subscriptions as subscription
    on subscription.profile_id = member.profile_id
    and subscription.gone_at is null
    and (subscription.expiration_time is null or subscription.expiration_time > now())
  where member.conversation_id = p_message.conversation_id
    and member.left_at is null
    and member.profile_id is distinct from p_message.sender_id
    and (p_profile_ids is null or member.profile_id = any(p_profile_ids))
    and private.member_wants_message_push(member, p_message)
    and not private.profile_suspended(member.profile_id)
  on conflict do nothing;

  if found then
    perform private.wake_notification_dispatcher();
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.member_wants_message_push (
  p_member  public.conversation_members,
  p_message private.messages
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select (p_member.muted_until is null or p_member.muted_until <= now())
    and (
      not p_member.mentions_only
      or p_message.mentions_everyone
      or p_member.profile_id = any(p_message.mention_profile_ids)
    );
$function$;

CREATE OR REPLACE FUNCTION private.message_delivery_allowed (
  p_delivery private.notification_delivery_outbox
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from private.messages as message
    join private.web_push_subscriptions as subscription
      on subscription.id = p_delivery.subscription_id
      and subscription.profile_id = p_delivery.recipient_profile_id
      and subscription.gone_at is null
      and (subscription.expiration_time is null or subscription.expiration_time > now())
    join public.conversation_members as member
      on member.conversation_id = message.conversation_id
      and member.profile_id = p_delivery.recipient_profile_id
      and member.left_at is null
      and message.sent_at >= member.joined_at
    where message.id = p_delivery.message_id
      and message.deleted_at is null
      and private.member_wants_message_push(member, message)
      and (member.last_read_sent_at, member.last_read_message_id) < (message.sent_at, message.id)
      and (
        not exists (
          select 1
          from private.notification_delivery_outbox as newer
          join private.messages as newer_message on newer_message.id = newer.message_id
          where newer.subscription_id = p_delivery.subscription_id
            and newer.id <> p_delivery.id
            and newer.status in ('pending', 'leased')
            and newer_message.conversation_id = message.conversation_id
            and (newer_message.sent_at, newer_message.id) > (message.sent_at, message.id)
        )
        or exists (
          select 1
          from private.notification_delivery_outbox as skipped
          join private.messages as skipped_message on skipped_message.id = skipped.message_id
          where skipped.subscription_id = p_delivery.subscription_id
            and skipped.status = 'suppressed'
            and skipped_message.conversation_id = message.conversation_id
            and skipped_message.deleted_at is null
            and skipped_message.sent_at <= now() - interval '10 seconds'
            and (member.last_read_sent_at, member.last_read_message_id)
              < (skipped_message.sent_at, skipped_message.id)
            and skipped_message.sent_at > coalesce(
              (
                select max(sent_message.sent_at)
                from private.notification_delivery_outbox as sent
                join private.messages as sent_message on sent_message.id = sent.message_id
                where sent.subscription_id = p_delivery.subscription_id
                  and sent.status = 'sent'
                  and sent_message.conversation_id = message.conversation_id
              ),
              '-infinity'
            )
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.message_plain_text (
  p_body                text,
  p_mention_profile_ids bigint[]
)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare
  rest text := p_body;
  result text := '';
  token text[];
  token_text text;
  shown_name text;
begin
  -- 멘션이 없는 대부분의 메시지는 정규식을 돌리지 않는다.
  if p_body is null or strpos(p_body, '](m:') = 0 then
    return p_body;
  end if;

  loop
    token := pg_catalog.regexp_match(rest, '\[@([^\]\n]*)\]\(m:([0-9]{1,2})\)');
    exit when token is null;
    token_text := '[@' || token[1] || '](m:' || token[2] || ')';
    select profile.name
    into shown_name
    from public.profiles as profile
    where profile.id = p_mention_profile_ids[token[2]::integer]
      and profile.deleted_at is null;
    -- 처음 맞은 자리가 곧 같은 글자가 처음 나오는 자리다.
    result := result || left(rest, strpos(rest, token_text) - 1)
      || '@' || coalesce(shown_name, token[1]);
    rest := substr(rest, strpos(rest, token_text) + char_length(token_text));
  end loop;

  return result || rest;
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
            private.message_plain_text(
              private.decrypt_message_text(message.body_ciphertext, message.key_version, p_keys),
              message.mention_profile_ids
            ),
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
            private.decrypt_message_text(original.body_ciphertext, original.key_version, p_keys),
            original.mention_profile_ids
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
          and attachment.status = 'ready'
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

CREATE OR REPLACE FUNCTION private.resolve_message_mentions (
  p_conversation_id   uuid,
  p_body              text,
  p_mention_pub_ids   text[],
  p_already_mentioned bigint[]                 DEFAULT '{}'::bigint[],
  p_sent_at           timestamp with time zone DEFAULT NULL::timestamp WITH time zone
)
  RETURNS bigint[]
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare
  ordinals smallint[] := private.parse_mention_ordinals(p_body);
  person_count integer := cardinality(array_remove(ordinals, 0::smallint));
  resolved bigint[];
begin
  if cardinality(ordinals) = 0 then
    return '{}';
  end if;
  if not exists (
    select 1
    from public.conversations as conversation
    where conversation.id = p_conversation_id
      and conversation.type = 'group'
  ) then
    raise exception 'mentions are only available in group conversations'
      using errcode = '22023';
  end if;
  if person_count = 0 then
    return '{}';
  end if;
  if person_count > 50 then
    raise exception 'a message can mention at most 50 members'
      using errcode = '22023';
  end if;
  -- 번호는 중복 없이 오름차순이므로 마지막 번호가 사람 수와 같으면 1부터 빈틈없다.
  if ordinals[cardinality(ordinals)] <> person_count then
    raise exception 'mention ordinals must be consecutive'
      using errcode = '22023';
  end if;

  select array_agg(profile.id order by entry.ordinal)
  into resolved
  from generate_series(1, person_count) as entry(ordinal)
  join public.profiles as profile
    on lower(profile.pub_id) = lower(btrim(coalesce(p_mention_pub_ids[entry.ordinal], '')))
    and profile.status = 'accepted'
    and profile.deleted_at is null
  where profile.id = any(p_already_mentioned)
    or exists (
      select 1
      from public.conversation_members as member
      where member.conversation_id = p_conversation_id
        and member.profile_id = profile.id
        and member.left_at is null
        and (p_sent_at is null or member.joined_at <= p_sent_at)
    );

  if coalesce(cardinality(resolved), 0) <> person_count then
    raise exception 'every mention must name a current conversation member'
      using errcode = '22023';
  end if;
  if (select count(distinct entry.profile_id) from unnest(resolved) as entry(profile_id))
    <> person_count then
    raise exception 'a member can take only one mention ordinal'
      using errcode = '22023';
  end if;

  return resolved;
end;
$function$;

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
    key_version = null,
    mention_profile_ids = '{}',
    mentions_everyone = false
  where message.id = any(p_message_ids)
    and message.deleted_at is null;
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

REVOKE ALL ON FUNCTION "public"."edit_message"(uuid, text, text[]) FROM PUBLIC, "anon", "service_role";

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
    notification_level           public.conversation_notification_level
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
    end::public.conversation_notification_level
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
        'pub_id', profile.pub_id,
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
    mentions_everyone     boolean
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
    mentions_everyone     boolean
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
    mentions_everyone     boolean
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
      private.decrypt_message_text(candidate.body_ciphertext, candidate.key_version, keys),
      candidate.mention_profile_ids
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

REVOKE ALL ON FUNCTION "public"."send_message"(uuid, uuid, text, uuid, boolean, text[]) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.set_conversation_notification_level (
  p_conversation_id uuid,
  p_level           public.conversation_notification_level
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
  if p_level is null then
    raise exception 'notification level required'
      using errcode = '22023';
  end if;
  if p_level = 'mentions' and not exists (
    select 1
    from public.conversations as conversation
    where conversation.id = p_conversation_id
      and conversation.type = 'group'
  ) then
    raise exception 'mentions level requires a group conversation'
      using errcode = '22023';
  end if;

  update public.conversation_members as member
  set muted_until = case when p_level = 'off' then 'infinity'::timestamptz end,
    mentions_only = p_level = 'mentions'
  where member.conversation_id = p_conversation_id
    and member.profile_id = caller_profile_id
    and member.left_at is null;

  if not found then
    raise exception 'conversation member required'
      using errcode = '42501';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."set_conversation_notification_level"(uuid, public.conversation_notification_level) FROM PUBLIC, "anon", "service_role";

ALTER TABLE "private"."messages"
  ADD CONSTRAINT "messages_mentions_check" CHECK ((((system_kind IS NULL) AND (deleted_at IS NULL)) OR ((cardinality(mention_profile_ids) = 0) AND (NOT mentions_everyone))));

REVOKE ALL ON FUNCTION "private"."enqueue_message_push"(private.messages, bigint[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."member_wants_message_push"(public.conversation_members, private.messages) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."message_plain_text"(text, bigint[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."message_rows"(bigint, uuid, uuid[], jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."resolve_message_mentions"(uuid, text, text[], bigint[], timestamp WITH time zone) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."edit_message"(uuid, text, text[]) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."edit_message"(uuid, text, text[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."edit_message"(uuid, text, text[]) TO "postgres";

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

GRANT EXECUTE ON FUNCTION "public"."send_message"(uuid, uuid, text, uuid, boolean, text[]) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."send_message"(uuid, uuid, text, uuid, boolean, text[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."send_message"(uuid, uuid, text, uuid, boolean, text[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_conversation_notification_level"(uuid, public.conversation_notification_level) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_conversation_notification_level"(uuid, public.conversation_notification_level) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_conversation_notification_level"(uuid, public.conversation_notification_level) TO "postgres";
