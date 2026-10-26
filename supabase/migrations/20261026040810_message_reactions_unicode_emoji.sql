SET local check_function_bodies = off;

DROP FUNCTION "private"."message_rows"(bigint, uuid, uuid[], jsonb);

DROP FUNCTION "public"."list_message_changes"(uuid, timestamp WITH time zone, integer);

DROP FUNCTION "public"."list_message_reactors"(uuid);

DROP FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer);

DROP FUNCTION "public"."list_pinned_messages"(uuid);

DROP FUNCTION "public"."set_message_reaction"(uuid, public.post_reaction);

ALTER TABLE "private"."message_reactions"
  ALTER COLUMN "reaction" DROP DEFAULT;

ALTER TABLE "private"."message_reactions"
  ALTER COLUMN "reaction" TYPE text USING "reaction"::text;

-- 기존 6종 반응을 빠른 반응 줄의 같은 그림으로 옮긴다. 맨 아래 check 제약은 ASCII만인 값을 막으므로
-- 제약보다 먼저 바꿔야 한다.
UPDATE "private"."message_reactions"
SET "reaction" = CASE "reaction"
  WHEN 'like' THEN '👍'
  WHEN 'love' THEN '❤️'
  WHEN 'haha' THEN '😆'
  WHEN 'wow' THEN '😮'
  WHEN 'sad' THEN '😢'
  WHEN 'angry' THEN '😡'
END
WHERE "reaction" IN ('like', 'love', 'haha', 'wow', 'sad', 'angry');

CREATE OR REPLACE FUNCTION private.is_message_reaction (
  p_reaction text
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select p_reaction is not null
    and char_length(p_reaction) between 1 and 16
    and p_reaction !~ '[[:space:][:cntrl:][:alpha:]]'
    and p_reaction ~ '[^[:ascii:]]';
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
    my_reaction           text,
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
    my_reaction           text,
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

CREATE OR REPLACE FUNCTION public.list_message_reactors (
  p_message_id uuid
)
  RETURNS TABLE (
    profile_id  bigint,
    name        text,
    avatar_path text,
    reaction    text,
    reacted_at  timestamp with time zone
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

  return query
  select
    profile.id,
    -- 그 대화의 별명이 이름보다 앞선다(기능 명세 §13.25). 탈퇴한 사람의 별명은 남지 않는다.
    coalesce(nickname.nickname, profile.name),
    profile.avatar_path,
    entry.reaction,
    entry.created_at
  from private.message_reactions as entry
  join private.messages as message on message.id = entry.message_id
  join public.profiles as profile on profile.id = entry.profile_id
  left join private.conversation_nicknames as nickname
    on nickname.conversation_id = message.conversation_id
    and nickname.profile_id = entry.profile_id
  where entry.message_id = p_message_id
    and exists (
      select 1
      from public.conversation_members as period
      where period.conversation_id = message.conversation_id
        and period.profile_id = caller_profile_id
        and message.sent_at >= period.joined_at
        and (period.left_at is null or message.sent_at < period.left_at)
    )
  order by entry.reaction, entry.created_at, profile.id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_message_reactors"(uuid) FROM PUBLIC, "anon", "service_role";

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
    my_reaction           text,
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
    my_reaction           text,
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

CREATE OR REPLACE FUNCTION public.set_message_reaction (
  p_message_id uuid,
  p_reaction   text DEFAULT NULL::text
)
  RETURNS TABLE (
    reactions   jsonb,
    my_reaction text
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

  if p_reaction is not null and not private.is_message_reaction(p_reaction) then
    raise exception 'reaction must be an emoji'
      using errcode = '22023';
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

REVOKE ALL ON FUNCTION "public"."set_message_reaction"(uuid, text) FROM PUBLIC, "anon", "service_role";

REVOKE ALL ON FUNCTION "private"."is_message_reaction"(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."message_rows"(bigint, uuid, uuid[], jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."list_message_changes"(uuid, timestamp WITH time zone, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_message_changes"(uuid, timestamp WITH time zone, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_message_changes"(uuid, timestamp WITH time zone, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_message_reactors"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_message_reactors"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_message_reactors"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_pinned_messages"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_pinned_messages"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_pinned_messages"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_message_reaction"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_message_reaction"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_message_reaction"(uuid, text) TO "postgres";

ALTER TABLE "private"."message_reactions"
  ADD CONSTRAINT "message_reactions_reaction_check" CHECK (private.is_message_reaction(reaction));
