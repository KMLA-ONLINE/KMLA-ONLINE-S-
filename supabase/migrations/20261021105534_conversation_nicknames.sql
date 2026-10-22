SET local check_function_bodies = off;

ALTER TABLE "private"."messages"
  DROP CONSTRAINT "messages_system_check";

DROP FUNCTION "private"."message_plain_text"(text, bigint[]);

CREATE TABLE "private"."conversation_nicknames" (
  "conversation_id" uuid   NOT NULL,
  "profile_id"      bigint NOT NULL,
  "nickname"        text   NOT NULL,
  CONSTRAINT "conversation_nicknames_pkey" PRIMARY KEY (conversation_id, profile_id)
);

ALTER TABLE "private"."conversation_nicknames"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.is_valid_conversation_nickname (
  p_nickname text
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select p_nickname = pg_catalog.btrim(p_nickname)
    and pg_catalog.char_length(p_nickname) between 1 and 20
    -- 코드 포인트로 비교한다. 정규식에 보이지 않는 글자를 그대로 적으면 읽을 수 없다.
    and not exists (
      select 1
      from pg_catalog.regexp_split_to_table(p_nickname, '') as letter
      cross join lateral (select pg_catalog.ascii(letter) as code) as point
      where point.code < 32
        or point.code between 127 and 159
        -- 소프트 하이픈, 자소 결합자, 한글 초·중성 채움, 크메르 모음 채움, 몽골 모음 구분자,
        -- 점자 빈칸, 한글 채움, BOM, 반각 한글 채움
        or point.code in (173, 847, 4447, 4448, 6068, 6069, 6158, 10240, 12644, 65279, 65440)
        -- U+200B~U+200F 폭 없는 공백과 방향 표시, U+202A~U+202E 방향 덮어쓰기,
        -- U+2060~U+2064 단어 결합자 등, U+2066~U+2069 방향 격리
        or point.code between 8203 and 8207
        or point.code between 8234 and 8238
        or point.code between 8288 and 8292
        or point.code between 8294 and 8297
    )
    -- 공백(U+0020, U+00A0, U+2000~U+200A, U+3000)이 아닌 글자가 하나는 있어야 한다.
    and exists (
      select 1
      from pg_catalog.regexp_split_to_table(p_nickname, '') as letter
      where pg_catalog.ascii(letter) not in (32, 160, 12288)
        and pg_catalog.ascii(letter) not between 8192 and 8202
    );
$function$;

CREATE OR REPLACE FUNCTION private.message_plain_text (
  p_body text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select pg_catalog.regexp_replace(p_body, '\[@([^\]\n]*)\]\(m:[0-9]{1,2}\)', '@\1', 'g');
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
          then coalesce(sender_nickname.nickname, sender.name, '알 수 없는 사용자') || ': '
        else ''
      end
      || case
        when coalesce(preference.message_preview_hidden, false) then '새 메시지가 있습니다.'
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

CREATE OR REPLACE FUNCTION public.list_message_reactors (
  p_message_id uuid
)
  RETURNS TABLE (
    profile_id  bigint,
    name        text,
    avatar_path text,
    reaction    public.post_reaction,
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

CREATE OR REPLACE FUNCTION public.set_conversation_nickname (
  p_conversation_id uuid,
  p_profile_id      bigint,
  p_nickname        text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  normalized_nickname text := nullif(btrim(coalesce(p_nickname, '')), '');
  previous_nickname text;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if normalized_nickname is not null
    and not private.is_valid_conversation_nickname(normalized_nickname)
  then
    raise exception 'nickname must be 1 to 20 visible characters'
      using errcode = '22023';
  end if;

  perform private.lock_group_for_member(caller_profile_id, p_conversation_id);
  if not exists (
    select 1
    from public.conversation_members as member
    where member.conversation_id = p_conversation_id
      and member.profile_id = p_profile_id
      and member.left_at is null
  ) then
    raise exception 'nickname target must be a current member'
      using errcode = '22023';
  end if;

  select nickname.nickname
  into previous_nickname
  from private.conversation_nicknames as nickname
  where nickname.conversation_id = p_conversation_id
    and nickname.profile_id = p_profile_id;
  if previous_nickname is not distinct from normalized_nickname then
    return;
  end if;

  if normalized_nickname is null then
    delete from private.conversation_nicknames as nickname
    where nickname.conversation_id = p_conversation_id
      and nickname.profile_id = p_profile_id;
    perform private.insert_system_message(
      p_conversation_id, 'nickname_cleared', array[caller_profile_id, p_profile_id]
    );
  else
    insert into private.conversation_nicknames (conversation_id, profile_id, nickname)
    values (p_conversation_id, p_profile_id, normalized_nickname)
    on conflict (conversation_id, profile_id)
    do update set nickname = excluded.nickname;
    perform private.insert_system_message(
      p_conversation_id, 'nickname_set', array[caller_profile_id, p_profile_id],
      normalized_nickname
    );
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."set_conversation_nickname"(uuid, bigint, text) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.withdraw_account()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_auth_user_id uuid := auth.uid();
  caller public.profiles;
  conversation_id uuid;
  timeline_post_ids uuid[];
begin
  select profile.* into caller
  from public.profiles as profile
  where profile.auth_user_id = caller_auth_user_id
    and caller_auth_user_id is not null
    and profile.status = 'accepted'
    and profile.deleted_at is null
  for update;

  if caller.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  perform private.require_recent_password_auth();

  -- 소유권 이전(`transfer_group_ownership`)도 대상 멤버십을 잠근다. 검사 전에 먼저 잠가야, 동시에
  -- 넘겨받은 소유자 행을 아래에서 지워 소유자 없는 그룹을 만드는 일이 없다.
  perform 1
  from public.group_memberships as membership
  where membership.profile_id = caller.id
  for update;

  if caller.role = 'admin' then
    -- 화면이 사유별 안내를 고르도록 hint로 구분한다.
    raise exception 'app administrator role must be released before withdrawal'
      using errcode = '55000', hint = 'app_admin';
  end if;
  if exists (
    select 1
    from public.group_memberships as membership
    where membership.profile_id = caller.id
      and membership.role = 'owner'
  ) then
    raise exception 'group ownership must be transferred before withdrawal'
      using errcode = '55000', hint = 'group_owner';
  end if;

  -- 1:1 대화는 상대의 기록으로 남기되 내 참여 기간만 닫는다. 열어 두면 상대 메시지의 안 읽은
  -- 수에 탈퇴자가 영원히 남는다. 새 메시지는 `send_message`가 거부한다.
  update public.conversation_members as member
  set left_at = clock_timestamp(),
    left_by_self = true
  from public.conversations as conversation
  where conversation.id = member.conversation_id
    and conversation.type = 'direct'
    and member.profile_id = caller.id
    and member.left_at is null;

  -- 그룹 대화는 나가며 남은 멤버에게 나갔다는 표시를 남긴다.
  for conversation_id in
    select member.conversation_id
    from public.conversation_members as member
    join public.conversations as conversation on conversation.id = member.conversation_id
    where member.profile_id = caller.id
      and member.left_at is null
      and conversation.type = 'group'
    order by member.conversation_id
  loop
    perform private.lock_group_for_member(caller.id, conversation_id);
    perform private.leave_group_conversation(caller.id, conversation_id);
  end loop;
  -- 남이 붙여 준 별명도 지운다. 탈퇴한 사람은 이름 대신 탈퇴 표시를 그리므로 남길 까닭이 없다.
  delete from private.conversation_nicknames as nickname
  where nickname.profile_id = caller.id;

  -- 타임라인 주인이 탈퇴하면 그 타임라인의 글은 아무도 읽을 수 없으므로 남의 글까지 함께 지운다.
  select coalesce(array_agg(post.id), '{}') into timeline_post_ids
  from public.posts as post
  where post.timeline_profile_id = caller.id;
  perform private.purge_posts(timeline_post_ids);

  with deleted as (
    delete from public.stories as story
    where story.profile_id = caller.id
    returning story.image_path, story.thumbnail_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'story-media', path.object_path, 'story_media'
  from deleted
  cross join lateral (values (deleted.image_path), (deleted.thumbnail_path)) as path(object_path)
  where path.object_path is not null
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;

  with deleted as (
    delete from public.profile_media_objects as media
    where media.profile_id = caller.id
    returning media.object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'profile-media', deleted.object_path, 'profile_media'
  from deleted
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;

  with deleted as (
    delete from public.profile_media_activity_objects as activity
    where activity.profile_id = caller.id
    returning activity.object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'profile-media', deleted.object_path, 'profile_media_activity'
  from deleted
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;

  delete from public.group_join_requests where profile_id = caller.id;
  delete from private.group_invites where created_by = caller.id;
  delete from public.user_timetables where profile_id = caller.id;
  delete from public.notification_preferences where profile_id = caller.id;
  delete from private.web_push_subscriptions where profile_id = caller.id;
  delete from private.notification_delivery_outbox where recipient_profile_id = caller.id;
  delete from public.notifications where recipient_profile_id = caller.id;
  delete from public.profile_permissions where profile_id = caller.id;
  delete from private.feed_sessions where profile_id = caller.id;
  delete from public.story_views where profile_id = caller.id;
  -- 지난 예약도 신청자 이름 사본을 들고 있다.
  delete from public.utility_reservations where profile_id = caller.id;
  -- 신고와 제재 기록은 묘비에 남겨도 재가입한 새 계정과 이을 수 없고(학번·Auth 연결을 지운다),
  -- 개인정보처리방침 4항이 탈퇴 때 삭제를 약속한다.
  delete from private.group_post_reports where reporter_profile_id = caller.id;
  delete from private.profile_suspensions where profile_id = caller.id;
  delete from private.group_anonymous_activity_restrictions where profile_id = caller.id;
  -- 진행 중인 회차의 신청만 풀어 다른 사람이 신청할 수 있게 한다. 마감한 회차의 신청은 배부
  -- 기록이므로 건드리지 않는다.
  update public.donation_claims as claim
  set cancelled_at = now()
  from public.donation_items as item
  join public.donation_rounds as round on round.id = item.round_id
  where item.id = claim.item_id
    and claim.profile_id = caller.id
    and claim.cancelled_at is null
    and now() >= round.opens_at
    and now() < round.closes_at;

  -- 다른 회원의 알림에 복사된 이름과 사진. 읽기 경로가 빈 이름을 "탈퇴한 사용자"로 그린다.
  update public.notifications
  set actor_display_name = null, actor_avatar_path = null
  where actor_profile_id = caller.id;

  -- 상태 전환 트리거가 공식 그룹 멤버십을 지우므로 나머지 그룹 멤버십을 그 뒤에 지운다.
  update public.profiles
  set status = 'withdrawn',
    deleted_at = now(),
    -- 사용자가 고른 공개 ID도 식별 정보다. 무작위 값으로 바꿔 묘비와 사람의 연결을 끊는다.
    pub_id = private.generate_profile_pub_id(),
    status_updated_at = now(),
    status_updated_by = caller.id,
    auth_user_id = null,
    role = 'member',
    name = '탈퇴한 사용자',
    anonymous_username = null,
    student_number = null,
    class_no = null,
    cohort = null,
    gender = null,
    academic_track = null,
    phone_number = null,
    avatar_path = null,
    cover_path = null,
    birthday = null,
    description = null,
    dorm_room = null,
    contact_email = null,
    department = null,
    is_returning_student = false
  where id = caller.id;

  delete from public.group_memberships where profile_id = caller.id;

  -- 세션과 identity는 FK CASCADE로 함께 지워진다. 이미 발급된 access token은 만료까지 남지만
  -- 프로필에 이어지지 않아 모든 RLS·RPC 검사에서 거부된다.
  delete from auth.users where id = caller_auth_user_id;

  -- 위에서 큐에 넣은 미디어를 바로 지우도록 워커를 깨운다. `purge_posts`도 깨우지만 그때는 아직
  -- 미디어가 큐에 없다. 실패해도 경로는 큐에 남아 백스톱이 받는다(삭제 및 보존 정책 §4.1).
  perform private.invoke_storage_cleanup(p_quiet => true);
end;
$function$;

ALTER TABLE "private"."conversation_nicknames"
  ADD CONSTRAINT "conversation_nicknames_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE "private"."conversation_nicknames"
  ADD CONSTRAINT "conversation_nicknames_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "private"."messages"
  ADD CONSTRAINT "messages_system_check"
    CHECK
    ((((system_kind IS NULL) AND (system_profile_ids IS NULL) AND (system_name IS NULL)) OR ((system_kind = ANY (ARRAY['member_added'::text, 'member_left'::text,
    'member_removed'::text,
    'renamed'::text,
    'nickname_set'::text,
    'nickname_cleared'::text])) AND (sender_id IS NULL) AND (reply_to_id IS NULL) AND ((system_kind = ANY (ARRAY['renamed'::text, 'nickname_set'::text])) = (system_name IS
    NOT NULL)))));

CREATE POLICY "conversation_nicknames_deny_direct_access" ON "private"."conversation_nicknames"
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON FUNCTION "private"."is_valid_conversation_nickname"(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."message_plain_text"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."set_conversation_nickname"(uuid, bigint, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_conversation_nickname"(uuid, bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_conversation_nickname"(uuid, bigint, text) TO "postgres";

ALTER TABLE "private"."conversation_nicknames"
  ADD CONSTRAINT "conversation_nicknames_nickname_check" CHECK (private.is_valid_conversation_nickname(nickname));
