SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.normalize_message_body (
  p_body text
)
  RETURNS text
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
declare
  normalized text := pg_catalog.regexp_replace(coalesce(p_body, ''), '[\r\n]+$', '');
begin
  if normalized !~ '[^[:space:]]' or char_length(normalized) > 40000 then
    raise exception 'body must be 1 to 40000 characters'
      using errcode = '22023';
  end if;
  return normalized;
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
        using errcode = '55000', hint = 'recipient_withdrawn';
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
      elsif char_length(normalized_body) > 40000 then
        raise exception 'body must be at most 40000 characters'
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
