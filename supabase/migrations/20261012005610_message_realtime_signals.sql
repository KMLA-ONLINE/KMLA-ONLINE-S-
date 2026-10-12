SET local check_function_bodies = off;

DROP FUNCTION "private"."message_rows"(bigint, uuid, uuid[], jsonb);

DROP FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer);

DROP FUNCTION "public"."list_pinned_messages"(uuid);

ALTER TABLE "private"."messages"
  ADD COLUMN "changed_at" timestamp WITH time zone NOT NULL DEFAULT clock_timestamp();

CREATE OR REPLACE FUNCTION private.broadcast_message_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if coalesce(current_setting('messaging.suppress_signals', true) = 'on', false) then
    return null;
  end if;
  -- `content`는 대화 목록의 미리보기와 읽지 않은 수가 바뀔 수 있는 변경이다. 반응·고정은 `meta`라
  -- 클라이언트가 목록을 다시 읽지 않는다.
  perform realtime.send(
    jsonb_build_object(
      'conversation_id', new.conversation_id,
      'message_id', new.id,
      'kind', case
        when tg_op = 'INSERT'
          or old.body_ciphertext is distinct from new.body_ciphertext
          or old.deleted_at is distinct from new.deleted_at
          then 'content'
        else 'meta'
      end
    ),
    'message_changed',
    'messaging:' || member.profile_id::text,
    true
  )
  from public.conversation_members as member
  where member.conversation_id = new.conversation_id
    and member.left_at is null;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.broadcast_read_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if coalesce(current_setting('messaging.suppress_signals', true) = 'on', false) then
    return null;
  end if;
  perform realtime.send(
    jsonb_build_object('conversation_id', new.conversation_id),
    'read_changed',
    'messaging:' || member.profile_id::text,
    true
  )
  from public.conversation_members as member
  where member.conversation_id = new.conversation_id
    and member.left_at is null
    and member.profile_id <> new.profile_id;
  return null;
end;
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
    changed_at          timestamp with time zone
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
      when message.deleted_at is null
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
    message.changed_at
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
  where message.conversation_id = p_conversation_id
    and message.id = any(p_message_ids)
  order by message.sent_at, message.id;
$function$;

CREATE OR REPLACE FUNCTION private.touch_message()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  -- 바뀐 시각을 직접 적는 갱신(테스트)과 신호를 끈 운영 작업은 그 값을 둔다.
  if new.changed_at is not distinct from old.changed_at
    and not coalesce(current_setting('messaging.suppress_signals', true) = 'on', false) then
    new.changed_at := clock_timestamp();
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.touch_message_from_child()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if coalesce(current_setting('messaging.suppress_signals', true) = 'on', false) then
    return null;
  end if;
  update private.messages
  set changed_at = clock_timestamp()
  where id = coalesce(new.message_id, old.message_id);
  return null;
end;
$function$;

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
    changed_at          timestamp with time zone
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

CREATE OR REPLACE FUNCTION public.list_message_read_counts (
  p_conversation_id uuid,
  p_message_ids     uuid[]
)
  RETURNS TABLE (
    id                  uuid,
    unread_member_count integer
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
  if coalesce(cardinality(p_message_ids), 0) > 100 then
    raise exception 'at most 100 messages'
      using errcode = '22023';
  end if;

  return query
  select
    message.id,
    (
      select count(*)::integer
      from public.conversation_members as other
      where other.conversation_id = p_conversation_id
        and other.profile_id <> caller_profile_id
        and other.left_at is null
        and other.joined_at <= message.sent_at
        and (other.last_read_sent_at, other.last_read_message_id) < (message.sent_at, message.id)
    )
  from private.messages as message
  where message.conversation_id = p_conversation_id
    and message.id = any(p_message_ids)
    and message.sender_id = caller_profile_id
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

REVOKE ALL ON FUNCTION "public"."list_message_read_counts"(uuid, uuid[]) FROM PUBLIC, "anon";

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
    changed_at          timestamp with time zone
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
    changed_at          timestamp with time zone
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

CREATE INDEX messages_conversation_changed_idx ON private.messages USING btree (conversation_id, changed_at);

CREATE TRIGGER message_pins_touch
  AFTER INSERT OR DELETE ON private.message_pins
  FOR EACH ROW
  EXECUTE FUNCTION private.touch_message_from_child();

CREATE TRIGGER message_reactions_touch
  AFTER INSERT OR DELETE OR UPDATE ON private.message_reactions
  FOR EACH ROW
  EXECUTE FUNCTION private.touch_message_from_child();

CREATE TRIGGER messages_broadcast
  AFTER INSERT OR UPDATE ON private.messages
  FOR EACH ROW
  EXECUTE FUNCTION private.broadcast_message_change();

CREATE TRIGGER messages_touch
  BEFORE UPDATE ON private.messages
  FOR EACH ROW
  EXECUTE FUNCTION private.touch_message();

CREATE TRIGGER conversation_members_broadcast_read
  AFTER UPDATE OF last_read_sent_at, last_read_message_id ON public.conversation_members
  FOR EACH ROW
  WHEN ((old.last_read_message_id IS DISTINCT FROM new.last_read_message_id))
  EXECUTE FUNCTION private.broadcast_read_change();

CREATE POLICY "messaging_signals_receive_own" ON "realtime"."messages"
  FOR SELECT
  TO "authenticated"
  USING (((EXTENSION = 'broadcast'::text) AND (( SELECT realtime.topic() AS topic) = ('messaging:'::text || (( SELECT private.current_profile_id() AS current_profile_id))::text))));

REVOKE ALL ON FUNCTION "private"."broadcast_message_change"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."broadcast_read_change"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."message_rows"(bigint, uuid, uuid[], jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."touch_message"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."touch_message_from_child"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."list_message_changes"(uuid, timestamp WITH time zone, integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_message_read_counts"(uuid, uuid[]) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_pinned_messages"(uuid) TO "authenticated";
