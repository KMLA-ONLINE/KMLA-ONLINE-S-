SET local check_function_bodies = off;

DROP FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer);

CREATE TABLE "private"."message_pins" (
  "message_id"      uuid                     NOT NULL,
  "conversation_id" uuid                     NOT NULL,
  "pinned_by"       bigint,
  "pinned_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "message_pins_pkey" PRIMARY KEY (message_id)
);

ALTER TABLE "private"."message_pins"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "private"."message_pins" FROM PUBLIC, "anon", "authenticated";

CREATE TABLE "private"."message_reactions" (
  "message_id" uuid                     NOT NULL,
  "profile_id" bigint                   NOT NULL,
  "reaction"   public.post_reaction     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "message_reactions_pkey" PRIMARY KEY (message_id, profile_id)
);

ALTER TABLE "private"."message_reactions"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "private"."message_reactions" FROM PUBLIC, "anon", "authenticated";

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
    pinned              boolean
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
    pin.message_id is not null
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
  if normalized !~ '[^[:space:]]' or char_length(normalized) > 20000 then
    raise exception 'body must be 1 to 20000 characters'
      using errcode = '22023';
  end if;
  return normalized;
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

  delete from private.message_reactions as entry
  where entry.message_id = any(p_message_ids);

  delete from private.message_pins as pin
  where pin.message_id = any(p_message_ids);

  update private.messages as message
  set deleted_at = clock_timestamp(),
    body_ciphertext = null,
    key_version = null
  where message.id = any(p_message_ids)
    and message.deleted_at is null;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."delete_messages"(uuid[]) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.edit_message (
  p_message_id uuid,
  p_body       text
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

  select * into encrypted
  from private.encrypt_message_text(normalized_body, private.message_keys());

  update private.messages
  set body_ciphertext = encrypted.ciphertext,
    key_version = encrypted.key_version,
    edited_at = edited
  where id = target.id;

  return edited;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."edit_message"(uuid, text) FROM PUBLIC, "anon";

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
    pinned              boolean
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
    pinned              boolean
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
    normalized_body := private.normalize_message_body(p_body);

    -- 나가기와 겹치지 않도록 내 현재 참여 기간을 잠근다.
    perform 1
    from public.conversation_members as member
    where member.conversation_id = p_conversation_id
      and member.profile_id = caller_profile_id
      and member.left_at is null
    for share;

    if not found then
      raise exception 'conversation member required'
        using errcode = '42501';
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

CREATE OR REPLACE FUNCTION public.set_message_pinned (
  p_message_id uuid,
  p_pinned     boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target private.messages;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if p_pinned is null then
    raise exception 'pinned state required'
      using errcode = '22023';
  end if;

  target := private.lock_actionable_message(caller_profile_id, p_message_id);

  if p_pinned then
    insert into private.message_pins (message_id, conversation_id, pinned_by)
    values (target.id, target.conversation_id, caller_profile_id)
    on conflict (message_id) do nothing;
  else
    delete from private.message_pins as pin
    where pin.message_id = target.id;
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."set_message_pinned"(uuid, boolean) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_message_reaction (
  p_message_id uuid,
  p_reaction   public.post_reaction DEFAULT NULL
)
  RETURNS TABLE (
    reactions   jsonb,
    my_reaction public.post_reaction
  )
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

  perform private.lock_actionable_message(caller_profile_id, p_message_id);

  if p_reaction is null then
    delete from private.message_reactions as entry
    where entry.message_id = p_message_id
      and entry.profile_id = caller_profile_id;
  else
    insert into private.message_reactions (message_id, profile_id, reaction)
    values (p_message_id, caller_profile_id, p_reaction)
    on conflict (message_id, profile_id) do update
    set reaction = excluded.reaction,
      created_at = now();
  end if;

  return query
  select
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('reaction', counted.reaction, 'count', counted.n)
          order by counted.n desc, counted.reaction
        )
        from (
          select entry.reaction, count(*)::integer as n
          from private.message_reactions as entry
          where entry.message_id = p_message_id
          group by entry.reaction
        ) as counted
      ),
      '[]'::jsonb
    ),
    p_reaction;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."set_message_reaction"(uuid, public.post_reaction) FROM PUBLIC, "anon";

ALTER TABLE "private"."message_pins"
  ADD CONSTRAINT "message_pins_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE "private"."message_pins"
  ADD CONSTRAINT "message_pins_message_id_fkey" FOREIGN KEY (message_id) REFERENCES private.messages(id) ON DELETE CASCADE;

ALTER TABLE "private"."message_pins"
  ADD CONSTRAINT "message_pins_pinned_by_fkey" FOREIGN KEY (pinned_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "private"."message_reactions"
  ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY (message_id) REFERENCES private.messages(id) ON DELETE CASCADE;

ALTER TABLE "private"."message_reactions"
  ADD CONSTRAINT "message_reactions_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE INDEX message_pins_conversation_idx ON private.message_pins USING btree (conversation_id);

CREATE POLICY "message_pins_deny_direct_access" ON "private"."message_pins"
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

CREATE POLICY "message_reactions_deny_direct_access" ON "private"."message_reactions"
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON FUNCTION "private"."lock_actionable_message"(bigint, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."message_rows"(bigint, uuid, uuid[], jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."normalize_message_body"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."delete_messages"(uuid[]) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."edit_message"(uuid, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_pinned_messages"(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."set_message_pinned"(uuid, boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."set_message_reaction"(uuid, public.post_reaction) TO "authenticated";
