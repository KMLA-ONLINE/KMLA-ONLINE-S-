SET local check_function_bodies = off;

DROP FUNCTION "public"."list_conversations"(uuid);

ALTER TABLE "public"."conversation_members"
  ADD COLUMN "hidden_at" timestamp WITH time zone;

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
  ),
  listed_period as (
    -- 목록에 있는 대화만 센다. 스스로 나간 대화와, 숨긴 뒤로 사람이 보낸 메시지가 없는 대화는 목록에 없다
    -- (`list_conversations`와 같은 조건). 숨긴 뒤 메시지가 와서 다시 보이면 그동안 읽지 않은 메시지까지
    -- 센다. 대화마다 한 번만 판정한다.
    select latest_period.*
    from latest_period
    where not latest_period.left_by_self
      and (
        latest_period.hidden_at is null
        or exists (
          select 1
          from private.messages as later
          where later.conversation_id = latest_period.conversation_id
            and later.system_kind is null
            and later.sent_at > latest_period.hidden_at
            and (latest_period.left_at is null or later.sent_at < latest_period.left_at)
        )
      )
  )
  select count(*)::integer
  into total
  from listed_period
  join private.messages as message
    on message.conversation_id = listed_period.conversation_id
    and message.sender_id is distinct from caller_profile_id
    and message.deleted_at is null
    and message.system_kind is null
    and (message.sent_at, message.id)
      > (listed_period.last_read_sent_at, listed_period.last_read_message_id)
  where exists (
    select 1
    from public.conversation_members as period
    where period.conversation_id = listed_period.conversation_id
      and period.profile_id = caller_profile_id
      and message.sent_at >= period.joined_at
      and (period.left_at is null or message.sent_at < period.left_at)
  );

  return total;
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
  -- 숨긴 뒤로 메시지가 없으면 목록에서 뺀다. 숨긴 대화도 대화방은 열 수 있어야 한다.
  where p_conversation_id is not null
    or latest_period.hidden_at is null
    or last_message.sent_at > latest_period.hidden_at
  order by last_message.sent_at desc nulls last, conversation.created_at desc, conversation.id;
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

  update public.conversation_members as member
  set hidden_at = case when p_hidden then clock_timestamp() end
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

REVOKE ALL ON FUNCTION "public"."set_conversation_hidden"(uuid, boolean) FROM PUBLIC, "anon", "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_conversations"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_conversations"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_conversations"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_conversation_hidden"(uuid, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_conversation_hidden"(uuid, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_conversation_hidden"(uuid, boolean) TO "postgres";
