SET local check_function_bodies = off;

DROP FUNCTION "public"."get_accepted_profile"(text);

DROP FUNCTION
  "public"."update_my_profile"(text, text, date, text, text, public.profile_gender, smallint, public.profile_academic_track, text, smallint, smallint, boolean, boolean, text);

ALTER TABLE "public"."profiles"
  ADD COLUMN "status_message" text;

CREATE OR REPLACE FUNCTION public.get_accepted_profile (
  p_pub_id text
)
  RETURNS TABLE (
    id                   bigint,
    pub_id               text,
    name                 text,
    role                 public.app_role,
    type                 public.profile_type,
    student_number       text,
    class_no             smallint,
    cohort               smallint,
    gender               public.profile_gender,
    academic_track       public.profile_academic_track,
    phone_number         text,
    avatar_path          text,
    birthday             date,
    description          text,
    dorm_room            smallint,
    allow_timeline_posts boolean,
    cover_path           text,
    contact_email        text,
    department           text,
    is_returning_student boolean,
    status_message       text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select
    target.id, target.pub_id, target.name, target.role, target.type,
    target.student_number, target.class_no, target.cohort, target.gender,
    target.academic_track, target.phone_number, target.avatar_path,
    target.birthday, target.description, target.dorm_room,
    target.allow_timeline_posts, target.cover_path, target.contact_email,
    target.department, target.is_returning_student, target.status_message
  from public.profiles as target
  where lower(target.pub_id) = lower(btrim(p_pub_id))
    and target.status = 'accepted'
    and target.deleted_at is null
    and exists (
      select 1
      from public.profiles as viewer
      where viewer.auth_user_id = auth.uid()
        and viewer.status = 'accepted'
        and viewer.deleted_at is null
        and not private.profile_suspended(viewer.id)
    );
$function$;

REVOKE ALL ON FUNCTION "public"."get_accepted_profile"(text) FROM PUBLIC, "anon", "service_role";

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
        'withdrawn', profile.deleted_at is not null,
        'status_message', profile.status_message
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

CREATE OR REPLACE FUNCTION public.update_my_profile (
  p_name                 text,
  p_description          text                          DEFAULT NULL::text,
  p_birthday             date                          DEFAULT NULL::date,
  p_phone_number         text                          DEFAULT NULL::text,
  p_contact_email        text                          DEFAULT NULL::text,
  p_gender               public.profile_gender         DEFAULT NULL::public.profile_gender,
  p_cohort               smallint                      DEFAULT NULL::smallint,
  p_academic_track       public.profile_academic_track DEFAULT NULL::public.profile_academic_track,
  p_department           text                          DEFAULT NULL::text,
  p_class_no             smallint                      DEFAULT NULL::smallint,
  p_dorm_room            smallint                      DEFAULT NULL::smallint,
  p_allow_timeline_posts boolean                       DEFAULT true,
  p_is_returning_student boolean                       DEFAULT false,
  p_pub_id               text                          DEFAULT NULL::text,
  p_status_message       text                          DEFAULT NULL::text
)
  RETURNS public.profiles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id uuid := auth.uid();
  current_profile public.profiles;
  updated_profile public.profiles;
  next_pub_id text := nullif(btrim(lower(coalesce(p_pub_id, ''))), '');
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.auth_user_id = caller_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id)
  for update;

  if current_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  -- 공개 ID를 비워 보내면 바꾸지 않겠다는 뜻이다. 형식과 예약어는 profiles의 check
  -- 제약이 판정하고, 여기서는 선점 여부만 미리 본다. 고유 인덱스가 뒤를 받치므로 이
  -- 검사는 경합을 막으려는 것이 아니라 흔한 실패에 23505를 붙여 주기 위한 것이다 (§12.2).
  next_pub_id := coalesce(next_pub_id, current_profile.pub_id);

  if next_pub_id <> lower(current_profile.pub_id)
    and exists (
      select 1
      from public.profiles as other
      where lower(other.pub_id) = next_pub_id
    ) then
    raise exception 'public id already taken' using errcode = '23505';
  end if;

  if char_length(coalesce(p_description, '')) > 500 then
    raise exception 'description must be at most 500 characters'
      using errcode = '22001';
  end if;

  if char_length(btrim(coalesce(p_status_message, ''))) > 60 then
    raise exception 'status message must be at most 60 characters'
      using errcode = '22001';
  end if;

  if p_department is not null and char_length(btrim(p_department)) > 100 then
    raise exception 'department must be at most 100 characters'
      using errcode = '22001';
  end if;

  -- 생년월일·성별·계열은 선택 정보라 비울 수 있다. 기수만 학적 필수로 남는다.
  if current_profile.type in ('student', 'alumni') and p_cohort is null then
    raise exception 'academic profile fields are required'
      using errcode = '22023';
  end if;

  update public.profiles
  set
    pub_id = next_pub_id,
    name = btrim(p_name),
    description = nullif(btrim(coalesce(p_description, '')), ''),
    status_message = nullif(btrim(coalesce(p_status_message, '')), ''),
    birthday = p_birthday,
    phone_number = nullif(btrim(coalesce(p_phone_number, '')), ''),
    contact_email = nullif(btrim(coalesce(p_contact_email, '')), ''),
    allow_timeline_posts = p_allow_timeline_posts,

    is_returning_student = case
      when current_profile.type = 'student'
        then p_is_returning_student
      else false
    end,

    gender = case
      when current_profile.type in ('student', 'alumni') then p_gender
      else null
    end,

    cohort = current_profile.cohort,

    academic_track = case
      when current_profile.type in ('student', 'alumni')
        then p_academic_track
      else null
    end,

    department = case
      when current_profile.type = 'student'
        then nullif(btrim(coalesce(p_department, '')), '')
      else null
    end,

    class_no = case
      when current_profile.type = 'student' then p_class_no
      else null
    end,

    dorm_room = case
      when current_profile.type = 'student' then p_dorm_room
      else null
    end

  where id = current_profile.id
  returning * into updated_profile;

  return updated_profile;
end;
$function$;

REVOKE ALL
  ON FUNCTION
    "public"."update_my_profile"(text, text, date, text, text, public.profile_gender, smallint, public.profile_academic_track, text, smallint, smallint, boolean, boolean, text,
    text)
  FROM PUBLIC, "anon", "service_role";

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_status_message_check" CHECK (((status_message IS NULL) OR ((char_length(status_message) >= 1) AND (char_length(status_message) <= 60))));

GRANT EXECUTE ON FUNCTION "public"."get_accepted_profile"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_accepted_profile"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_accepted_profile"(text) TO "postgres";

GRANT EXECUTE
  ON FUNCTION
    "public"."update_my_profile"(text, text, date, text, text, public.profile_gender, smallint, public.profile_academic_track, text, smallint, smallint, boolean, boolean, text,
    text)
  TO "authenticated";

REVOKE ALL
  ON FUNCTION
    "public"."update_my_profile"(text, text, date, text, text, public.profile_gender, smallint, public.profile_academic_track, text, smallint, smallint, boolean, boolean, text,
    text)
  FROM "postgres";

GRANT EXECUTE
  ON FUNCTION
    "public"."update_my_profile"(text, text, date, text, text, public.profile_gender, smallint, public.profile_academic_track, text, smallint, smallint, boolean, boolean, text,
    text)
  TO "postgres";
