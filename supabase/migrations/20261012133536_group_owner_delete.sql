SET local check_function_bodies = off;

DROP FUNCTION "public"."list_conversations"(uuid);

DROP FUNCTION "public"."remove_conversation_member"(uuid, bigint);

CREATE OR REPLACE FUNCTION public.delete_group_conversation (
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

  if target.created_by is distinct from caller_profile_id and not exists (
    select 1
    from public.profiles as profile
    where profile.id = caller_profile_id
      and profile.role = 'admin'
  ) then
    raise exception 'group owner or app administrator required'
      using errcode = '42501';
  end if;

  perform realtime.send(
    jsonb_build_object('conversation_id', p_conversation_id),
    'conversation_deleted',
    'messaging:' || member.profile_id::text,
    true
  )
  from public.conversation_members as member
  where member.conversation_id = p_conversation_id
    and member.left_at is null;

  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'message-attachments', path.object_path, 'message_attachment'
  from private.message_attachments as attachment
  cross join lateral (
    values (attachment.object_path), (attachment.thumbnail_path)
  ) as path(object_path)
  where attachment.conversation_id = p_conversation_id
    and path.object_path is not null
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;

  delete from public.conversations where id = p_conversation_id;

  perform private.invoke_storage_cleanup(p_quiet => true);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."delete_group_conversation"(uuid) FROM PUBLIC, "anon";

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
  target public.conversations;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  target := private.lock_group_for_member(caller_profile_id, p_conversation_id);

  update public.conversation_members as member
  set left_at = clock_timestamp(),
    left_by_self = true
  where member.conversation_id = p_conversation_id
    and member.profile_id = caller_profile_id
    and member.left_at is null;

  -- 소유주가 나가면 가장 먼저 들어온 남은 멤버가 소유주가 된다. 아무도 없으면 비운다.
  if target.created_by = caller_profile_id then
    update public.conversations as conversation
    set created_by = (
      select member.profile_id
      from public.conversation_members as member
      where member.conversation_id = p_conversation_id
        and member.left_at is null
      order by member.joined_at, member.id
      limit 1
    )
    where conversation.id = p_conversation_id;
  end if;

  perform private.insert_system_message(
    p_conversation_id, 'member_left', array[caller_profile_id]
  );
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

REVOKE ALL ON FUNCTION "public"."list_conversations"(uuid) FROM PUBLIC, "anon";

GRANT EXECUTE ON FUNCTION "public"."delete_group_conversation"(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_conversations"(uuid) TO "authenticated";

