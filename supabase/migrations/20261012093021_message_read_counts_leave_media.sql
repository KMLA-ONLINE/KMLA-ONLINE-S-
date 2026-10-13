SET local check_function_bodies = off;

DROP FUNCTION "private"."message_rows"(bigint, uuid, uuid[], jsonb);

DROP FUNCTION "public"."list_message_changes"(uuid, timestamp WITH time zone, integer);

DROP FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer);

DROP FUNCTION "public"."list_pinned_messages"(uuid);

ALTER TABLE "public"."conversation_members"
  ADD COLUMN "left_by_self" boolean NOT NULL DEFAULT false;

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
    attachments           jsonb
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
          private.decrypt_message_text(original.body_ciphertext, original.key_version, p_keys),
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
    coalesce(files.list, '[]'::jsonb)
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
  )
  select count(*)::integer
  into total
  from latest_period
  -- 스스로 나간 대화는 목록에 없으므로 배지에도 세지 않는다.
  join private.messages as message
    on message.conversation_id = latest_period.conversation_id
    and message.sender_id is distinct from caller_profile_id
    and message.deleted_at is null
    and message.system_kind is null
    and (message.sent_at, message.id)
      > (latest_period.last_read_sent_at, latest_period.last_read_message_id)
  where not latest_period.left_by_self
    and exists (
      select 1
      from public.conversation_members as period
      where period.conversation_id = latest_period.conversation_id
        and period.profile_id = caller_profile_id
        and message.sent_at >= period.joined_at
        and (period.left_at is null or message.sent_at < period.left_at)
    );

  return total;
end;
$function$;

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
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  perform private.lock_group_for_member(caller_profile_id, p_conversation_id);

  update public.conversation_members as member
  set left_at = clock_timestamp(),
    left_by_self = true
  where member.conversation_id = p_conversation_id
    and member.profile_id = caller_profile_id
    and member.left_at is null;

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
    can_manage_members           boolean,
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
    attachments           jsonb
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
        and other.profile_id is distinct from message.sender_id
        and other.left_at is null
        and other.joined_at <= message.sent_at
        and (other.last_read_sent_at, other.last_read_message_id) < (message.sent_at, message.id)
    )
  from private.messages as message
  where message.conversation_id = p_conversation_id
    and message.id = any(p_message_ids)
    and message.system_kind is null
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
    attachments           jsonb
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
    attachments           jsonb
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

CREATE OR REPLACE FUNCTION public.prepare_message_attachments (
  p_conversation_id uuid,
  p_message_id      uuid,
  p_files           jsonb
)
  RETURNS TABLE (
    attachment_id  uuid,
    object_path    text,
    thumbnail_path text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  keys jsonb;
  file_count integer := coalesce(jsonb_array_length(p_files), 0);
  file jsonb;
  file_position integer := 0;
  file_kind text;
  file_name text;
  encrypted record;
  path text;
  thumbnail text;
  created_id uuid;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if p_message_id is null or jsonb_typeof(p_files) is distinct from 'array' then
    raise exception 'message id and files required'
      using errcode = '22023';
  end if;
  if file_count not between 1 and 10 then
    raise exception 'between 1 and 10 attachments required'
      using errcode = '22023';
  end if;
  if file_count > 1 and exists (
    select 1
    from jsonb_array_elements(p_files) as item
    where item ->> 'kind' is distinct from 'image'
  ) then
    raise exception 'several attachments must all be photos'
      using errcode = '22023';
  end if;
  -- 동영상과 GIF는 보낼 수 없다(기능 명세 §13.5). 업로더가 밝힌 종류, MIME type과 확장자로 막는다.
  if exists (
    select 1
    from jsonb_array_elements(p_files) as item
    where item ->> 'kind' = 'video'
      or lower(btrim(coalesce(item ->> 'mime_type', ''))) like 'video/%'
      or lower(btrim(coalesce(item ->> 'mime_type', ''))) = 'image/gif'
      or (
        lower(btrim(coalesce(item ->> 'mime_type', ''))) not like 'audio/%'
        and lower(btrim(coalesce(item ->> 'file_name', '')))
          ~ '\.(gif|mp4|m4v|mov|webm|mkv|avi|wmv|flv|3gp|3g2|mpe?g|ogv)$'
      )
  ) then
    raise exception 'videos and GIFs are not allowed'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.conversation_members as member
    where member.conversation_id = p_conversation_id
      and member.profile_id = caller_profile_id
      and member.left_at is null
  ) then
    raise exception 'conversation member required'
      using errcode = '42501';
  end if;
  if exists (select 1 from private.messages as message where message.id = p_message_id) then
    raise exception 'message already sent'
      using errcode = '23505';
  end if;

  update private.message_attachments as attachment
  set status = 'deleted'
  where attachment.message_id = p_message_id
    and attachment.status = 'pending'
    and attachment.uploader_id = caller_profile_id;

  keys := private.message_keys();

  for file in select item from jsonb_array_elements(p_files) as item loop
    file_kind := file ->> 'kind';
    file_name := btrim(coalesce(file ->> 'file_name', ''));
    if char_length(file_name) not between 1 and 255 then
      raise exception 'file name must be 1 to 255 characters'
        using errcode = '22023';
    end if;

    select * into encrypted from private.encrypt_message_text(file_name, keys);
    path := p_conversation_id::text || '/' || gen_random_uuid()::text;
    thumbnail := case when file_kind = 'image' then path || '/thumb' end;

    insert into private.message_attachments (
      conversation_id, message_id, uploader_id, position, kind, mime_type, size_bytes,
      width, height, object_path, thumbnail_path, filename_ciphertext, key_version
    ) values (
      p_conversation_id,
      p_message_id,
      caller_profile_id,
      file_position,
      file_kind,
      coalesce(nullif(btrim(file ->> 'mime_type'), ''), 'application/octet-stream'),
      (file ->> 'size_bytes')::bigint,
      (file ->> 'width')::integer,
      (file ->> 'height')::integer,
      path,
      thumbnail,
      encrypted.ciphertext,
      encrypted.key_version
    )
    returning id into created_id;

    attachment_id := created_id;
    object_path := path;
    thumbnail_path := thumbnail;
    return next;
    file_position := file_position + 1;
  end loop;
end;
$function$;

ALTER TABLE "public"."conversation_members"
  ADD CONSTRAINT "conversation_members_left_by_self_check" CHECK (((NOT left_by_self) OR (left_at IS NOT NULL)));

REVOKE ALL ON FUNCTION "private"."message_rows"(bigint, uuid, uuid[], jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."list_message_changes"(uuid, timestamp WITH time zone, integer) TO "authenticated";



GRANT EXECUTE ON FUNCTION "public"."list_messages"(uuid, timestamp WITH time zone, uuid, integer) TO "authenticated";



GRANT EXECUTE ON FUNCTION "public"."list_pinned_messages"(uuid) TO "authenticated";



-- 이미 스스로 나간 기간을 표시한다. `leave_conversation`은 나간 시각을 적은 직후 같은 트랜잭션에서
-- `member_left` 시스템 메시지를 남기므로, 그 메시지가 나간 시각 바로 뒤에 있는 기간이 스스로 나간
-- 기간이다. 내보내진 기간은 `member_removed`라 걸리지 않는다.
update public.conversation_members as member
set left_by_self = true
where member.left_at is not null
  and exists (
    select 1
    from private.messages as message
    where message.conversation_id = member.conversation_id
      and message.system_kind = 'member_left'
      and message.system_profile_ids[1] = member.profile_id
      and message.sent_at >= member.left_at
      and message.sent_at < member.left_at + interval '1 second'
  );
