SET local check_function_bodies = off;

DROP FUNCTION "public"."list_conversations"(uuid);

ALTER TABLE "public"."conversation_members"
  ADD COLUMN "pinned_at" timestamp WITH time zone;

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
    pinned                       boolean
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
    latest_period.pinned_at is not null
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

CREATE OR REPLACE FUNCTION public.set_conversation_hidden (
  p_conversation_id uuid,
  p_hidden          boolean
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
  if p_hidden is null then
    raise exception 'hidden state required'
      using errcode = '22023';
  end if;

  -- 숨기면 고정도 푼다. 목록에 없는 대화가 맨 위 자리를 들고 있을 이유가 없다(기능 명세 §13.23).
  update public.conversation_members as member
  set hidden_at = case when p_hidden then clock_timestamp() end,
    pinned_at = case when p_hidden then null else member.pinned_at end
  where member.id = (
    select latest.id
    from public.conversation_members as latest
    where latest.conversation_id = p_conversation_id
      and latest.profile_id = caller_profile_id
    order by latest.joined_at desc
    limit 1
  );

  if not found then
    raise exception 'conversation member required'
      using errcode = '42501';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_conversation_pinned (
  p_conversation_id uuid,
  p_pinned          boolean
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
  if p_pinned is null then
    raise exception 'pinned state required'
      using errcode = '22023';
  end if;

  update public.conversation_members as member
  set pinned_at = case when p_pinned then clock_timestamp() end
  where member.id = (
    select latest.id
    from public.conversation_members as latest
    where latest.conversation_id = p_conversation_id
      and latest.profile_id = caller_profile_id
    order by latest.joined_at desc
    limit 1
  );

  if not found then
    raise exception 'conversation member required'
      using errcode = '42501';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."set_conversation_pinned"(uuid, boolean) FROM PUBLIC, "anon", "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_conversations"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_conversations"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_conversations"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_conversation_pinned"(uuid, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_conversation_pinned"(uuid, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_conversation_pinned"(uuid, boolean) TO "postgres";
