SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.message_plain_text (
  p_body                text,
  p_mention_profile_ids bigint[]
)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select private.message_plain_text(p_body, p_mention_profile_ids, null::uuid);
$function$;

CREATE OR REPLACE FUNCTION private.message_plain_text (
  p_body                text,
  p_mention_profile_ids bigint[],
  p_conversation_id     uuid
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
    select coalesce(nickname.nickname, profile.name)
    into shown_name
    from public.profiles as profile
    left join private.conversation_nicknames as nickname
      on nickname.conversation_id = p_conversation_id and nickname.profile_id = profile.id
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
            original.mention_profile_ids, p_conversation_id
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
    coalesce(conversation.name, counterpart_nickname.nickname, counterpart.name),
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
          last_message.mention_profile_ids, conversation.id
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
  left join private.conversation_nicknames as counterpart_nickname
    on counterpart_nickname.conversation_id = conversation.id
    and counterpart_nickname.profile_id = counterpart.id
  left join lateral (
    -- 지금 멤버와 예전 멤버 모두. 나간 사람의 지난 메시지와 시스템 메시지에도 이름을 그려야 한다.
    -- 멤버 목록과 인원은 `active`인 사람만 센다.
    select jsonb_agg(
      jsonb_build_object(
        'id', profile.id,
        'pub_id', profile.pub_id,
        'name', coalesce(nickname.nickname, profile.name),
        'profile_name', profile.name,
        'nickname', nickname.nickname,
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
  order by last_message.sent_at desc nulls last, conversation.created_at desc, conversation.id;
end;
$function$;

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
      candidate.mention_profile_ids, p_conversation_id
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

REVOKE ALL ON FUNCTION "private"."message_plain_text"(text, bigint[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."message_plain_text"(text, bigint[], uuid) FROM PUBLIC;
