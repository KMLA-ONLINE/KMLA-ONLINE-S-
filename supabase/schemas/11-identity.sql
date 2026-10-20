-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.


CREATE TYPE "public"."app_role" AS ENUM (
    'member',
    'admin'
);

ALTER TYPE "public"."app_role" OWNER TO "postgres";

CREATE TYPE "public"."profile_academic_track" AS ENUM (
    'domestic',
    'international'
);

ALTER TYPE "public"."profile_academic_track" OWNER TO "postgres";

CREATE TYPE "public"."profile_gender" AS ENUM (
    'male',
    'female'
);

ALTER TYPE "public"."profile_gender" OWNER TO "postgres";

CREATE TYPE "public"."profile_media_activity_kind" AS ENUM (
    'avatar_changed',
    'cover_changed'
);

ALTER TYPE "public"."profile_media_activity_kind" OWNER TO "postgres";

CREATE TYPE "public"."profile_media_slot" AS ENUM (
    'avatar',
    'cover'
);

ALTER TYPE "public"."profile_media_slot" OWNER TO "postgres";

-- 그룹 미디어와 달리 `deleted` 상태가 없다. 프로필 이미지는 슬롯에서 내려와도 변경 활동
-- 게시물이 계속 참조하므로, 지울 수 있는 시점은 상태가 아니라 참조 유무로 판단한다.
-- `private.enqueue_storage_cleanup()`이 그 판단을 하고 행을 정리 큐로 옮긴다.
CREATE TYPE "public"."profile_media_status" AS ENUM (
    'pending',
    'ready'
);

ALTER TYPE "public"."profile_media_status" OWNER TO "postgres";

CREATE TYPE "public"."profile_status" AS ENUM (
    'draft',
    'pending',
    'accepted',
    'blocked',
    'withdrawn'
);

ALTER TYPE "public"."profile_status" OWNER TO "postgres";

CREATE TYPE "public"."profile_type" AS ENUM (
    'student',
    'alumni',
    'teacher'
);

ALTER TYPE "public"."profile_type" OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."can_read_profile_media_path"("p_object_path" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.profiles as viewer
    where viewer.auth_user_id = auth.uid()
      and viewer.status = 'accepted'
      and viewer.deleted_at is null
      and not private.profile_suspended(viewer.id)
  )
  and (
    exists (
      select 1
      from public.profiles as target
      where target.status = 'accepted'
        and target.deleted_at is null
        and p_object_path in (target.avatar_path, target.cover_path)
    )
    or exists (
      select 1
      from public.posts as post
      join public.profiles as timeline
        on timeline.id = post.timeline_profile_id
        and timeline.status = 'accepted'
        and timeline.deleted_at is null
      where post.activity_media_path = p_object_path
        and post.published_at is not null
        and private.can_read_post(post.id)
    )
  );
$$;

ALTER FUNCTION "private"."can_read_profile_media_path"("p_object_path" "text") OWNER TO "postgres";

-- 업로드는 자기 UUID 경로라는 이유만으로 허용되지 않고, 미리 만들어 둔 `pending` 행이 가리키는
-- 정확한 경로에만 허용된다. 경로 모양만 검사하던 이전 정책은 승인 사용자가 회수되지 않는 파일을
-- 무제한으로 올릴 수 있게 두었다.
CREATE OR REPLACE FUNCTION "private"."can_upload_profile_media"("p_object_path" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.profile_media_objects as media
    join public.profiles as profile on profile.id = media.profile_id
    where media.object_path = p_object_path
      and media.status = 'pending'
      and profile.auth_user_id = auth.uid()
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and not private.profile_suspended(profile.id)
  ) or exists (
    select 1
    from public.profile_media_activity_objects as activity
    join public.profiles as profile on profile.id = activity.profile_id
    where activity.object_path = p_object_path
      and activity.status = 'pending'
      and profile.auth_user_id = auth.uid()
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and not private.profile_suspended(profile.id)
  );
$$;

ALTER FUNCTION "private"."can_upload_profile_media"("p_object_path" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."generate_profile_pub_id"() RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  candidate text;
begin
  perform pg_catalog.pg_advisory_xact_lock(783094812);

  loop
    candidate := encode(extensions.gen_random_bytes(6), 'hex');
    exit when not exists (
      select 1
      from public.profiles as profile
      where lower(profile.pub_id::text) = candidate
    );
  end loop;

  return candidate;
end;
$$;

ALTER FUNCTION "private"."generate_profile_pub_id"() OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" bigint NOT NULL,
    "auth_user_id" "uuid",
    "pub_id" "text" DEFAULT "private"."generate_profile_pub_id"() NOT NULL,
    "name" "text" NOT NULL,
    "search_name" "text" GENERATED ALWAYS AS ("lower"("regexp_replace"("btrim"("name"), '[[:space:]]+'::"text", ''::"text", 'g'::"text"))) STORED,
    "anonymous_username" "text",
    "role" "public"."app_role" DEFAULT 'member'::"public"."app_role" NOT NULL,
    "type" "public"."profile_type" NOT NULL,
    "student_number" "text",
    "class_no" smallint,
    "cohort" smallint,
    "gender" "public"."profile_gender",
    "academic_track" "public"."profile_academic_track",
    "phone_number" "text",
    "avatar_path" "text",
    "birthday" "date",
    "description" "text",
    "status" "public"."profile_status" DEFAULT 'pending'::"public"."profile_status" NOT NULL,
    "dorm_room" smallint,
    "onboarding_completed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status_updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status_updated_by" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "allow_timeline_posts" boolean DEFAULT true NOT NULL,
    "cover_path" "text",
    "contact_email" "text",
    "department" "text",
    "is_returning_student" boolean DEFAULT false NOT NULL,
    "terms_version" "date",
    "terms_agreed_at" timestamp with time zone,
    CONSTRAINT "profiles_anonymous_username_length" CHECK ((("anonymous_username" IS NULL) OR (("char_length"("anonymous_username") >= 1) AND ("char_length"("anonymous_username") <= 50)))),
    CONSTRAINT "profiles_class_no_range" CHECK ((("class_no" IS NULL) OR (("class_no" >= 1) AND ("class_no" <= 10)))),
    CONSTRAINT "profiles_cohort_range" CHECK ((("cohort" IS NULL) OR (("cohort" >= 1) AND ("cohort" <= 100)))),
    CONSTRAINT "profiles_contact_email_format" CHECK ((("contact_email" IS NULL) OR ("contact_email" ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'::"text"))),
    CONSTRAINT "profiles_department_length" CHECK ((("department" IS NULL) OR (("char_length"("btrim"("department")) >= 1) AND ("char_length"("btrim"("department")) <= 100)))),
    CONSTRAINT "profiles_description_length" CHECK ((("description" IS NULL) OR ("char_length"("description") <= 500))),
    CONSTRAINT "profiles_dorm_room_range" CHECK ((("dorm_room" IS NULL) OR (("dorm_room" >= 101) AND ("dorm_room" <= 1008)))),
    CONSTRAINT "profiles_name_length" CHECK ((("char_length"("btrim"("name")) >= 1) AND ("char_length"("btrim"("name")) <= 50))),
    CONSTRAINT "profiles_phone_number_format" CHECK ((("phone_number" IS NULL) OR ("phone_number" ~ '^\+?[0-9 -]{8,20}$'::"text"))),
    CONSTRAINT "profiles_pub_id_format" CHECK (("pub_id" ~ '^[a-z0-9](?:[a-z0-9-]{3,13}[a-z0-9])$'::"text")),
    CONSTRAINT "profiles_pub_id_not_reserved" CHECK (("lower"("pub_id") <> ALL (ARRAY['admin'::"text", 'administrator'::"text", 'teacher'::"text", 'staff'::"text", 'moderator'::"text", 'support'::"text", 'system'::"text", 'root'::"text", 'sibal'::"text"]))),
    CONSTRAINT "profiles_student_number_format" CHECK ((("student_number" IS NULL) OR ("student_number" ~ '^[0-9]{6}$'::"text"))),
    CONSTRAINT "profiles_terms_agreement" CHECK ((("terms_version" IS NULL) = ("terms_agreed_at" IS NULL))),
    CONSTRAINT "profiles_type_details" CHECK ((("status" = 'withdrawn'::"public"."profile_status") OR (("type" = 'student'::"public"."profile_type") AND ("student_number" IS NOT NULL) AND ("cohort" IS NOT NULL)) OR (("type" = 'alumni'::"public"."profile_type") AND ("cohort" IS NOT NULL) AND ("class_no" IS NULL) AND ("dorm_room" IS NULL)) OR (("type" = 'teacher'::"public"."profile_type") AND ("student_number" IS NULL) AND ("class_no" IS NULL) AND ("cohort" IS NULL) AND ("gender" IS NULL) AND ("academic_track" IS NULL) AND ("dorm_room" IS NULL))))
);

ALTER TABLE "public"."profiles" OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_my_profile"() RETURNS SETOF "public"."profiles"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  -- 다른 기기에서 탈퇴하면 이 기기의 access token은 만료까지 서명이 유효하다. 빈 결과를 돌려주면
  -- 프로필 미작성과 구별되지 않으므로 세션 거절(42501)로 알려 클라이언트가 로그아웃하게 한다.
  if not exists (select 1 from auth.users as account where account.id = (select auth.uid())) then
    raise exception 'account not found'
      using errcode = '42501';
  end if;

  return query
  select profile.*
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.deleted_at is null;
end;
$$;

ALTER FUNCTION "public"."get_my_profile"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_accepted_profile"("p_pub_id" "text") RETURNS TABLE("id" bigint, "pub_id" "text", "name" "text", "role" "public"."app_role", "type" "public"."profile_type", "student_number" "text", "class_no" smallint, "cohort" smallint, "gender" "public"."profile_gender", "academic_track" "public"."profile_academic_track", "phone_number" "text", "avatar_path" "text", "birthday" "date", "description" "text", "dorm_room" smallint, "allow_timeline_posts" boolean, "cover_path" "text", "contact_email" "text", "department" "text", "is_returning_student" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    target.id, target.pub_id, target.name, target.role, target.type,
    target.student_number, target.class_no, target.cohort, target.gender,
    target.academic_track, target.phone_number, target.avatar_path,
    target.birthday, target.description, target.dorm_room,
    target.allow_timeline_posts, target.cover_path, target.contact_email,
    target.department, target.is_returning_student
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
$$;

ALTER FUNCTION "public"."get_accepted_profile"("p_pub_id" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_birthdays"("p_reference_date" "date", "p_scope" "text" DEFAULT 'month'::"text") RETURNS TABLE("pub_id" "text", "name" "text", "avatar_path" "text", "cohort" smallint, "is_returning_student" boolean, "birthday_month" smallint, "birthday_day" smallint, "birthday_date" "date")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  range_start date;
  range_end date;
  current_cohort smallint;
begin
  if p_reference_date is null then
    raise exception 'reference date is required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles as viewer
    where viewer.auth_user_id = auth.uid()
      and viewer.status = 'accepted'
      and viewer.deleted_at is null
      and not private.profile_suspended(viewer.id)
  ) then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  if p_scope = 'today' then
    range_start := p_reference_date;
    range_end := p_reference_date;
  elsif p_scope = 'month' then
    range_start := (p_reference_date - interval '1 month')::date;
    range_end := (p_reference_date + interval '1 month')::date;
  elsif p_scope = 'year' then
    range_start := p_reference_date;
    range_end := (p_reference_date + interval '1 year - 1 day')::date;
  else
    raise exception 'birthday scope must be today, month, or year' using errcode = '22023';
  end if;

  current_cohort := (extract(year from p_reference_date)::integer - 1995)::smallint;

  return query
  with eligible_profiles as (
    select
      profile.pub_id,
      profile.name,
      profile.avatar_path,
      profile.cohort,
      profile.is_returning_student,
      profile.birthday
    from public.profiles as profile
    where profile.status = 'accepted'
      and profile.deleted_at is null
      and profile.birthday is not null
      and (
        profile.type = 'teacher'
        or (
          profile.type = 'student'
          and (
            (
              profile.is_returning_student
              and profile.cohort = current_cohort - 3
            )
            or (
              not profile.is_returning_student
              and profile.cohort between current_cohort - 2 and current_cohort
            )
          )
        )
      )
  ), anniversaries as (
    select
      profile.pub_id,
      profile.name,
      profile.avatar_path,
      profile.cohort,
      profile.is_returning_student,
      extract(month from profile.birthday)::smallint as birthday_month,
      extract(day from profile.birthday)::smallint as birthday_day,
      make_date(
        calendar_year.value,
        extract(month from profile.birthday)::integer,
        least(
          extract(day from profile.birthday)::integer,
          extract(
            day from (
              make_date(
                calendar_year.value,
                extract(month from profile.birthday)::integer,
                1
              ) + interval '1 month - 1 day'
            )
          )::integer
        )
      ) as birthday_date
    from eligible_profiles as profile
    cross join lateral generate_series(
      extract(year from range_start)::integer,
      extract(year from range_end)::integer
    ) as calendar_year(value)
  )
  select
    anniversary.pub_id,
    anniversary.name,
    anniversary.avatar_path,
    anniversary.cohort,
    anniversary.is_returning_student,
    anniversary.birthday_month,
    anniversary.birthday_day,
    anniversary.birthday_date
  from anniversaries as anniversary
  where anniversary.birthday_date between range_start and range_end
  order by anniversary.birthday_date, anniversary.name, anniversary.pub_id;
end;
$$;

ALTER FUNCTION "public"."list_birthdays"("p_reference_date" "date", "p_scope" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."remove_my_profile_media"("p_slot" "text") RETURNS "public"."profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  current_profile public.profiles;
  updated_profile public.profiles;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_slot not in ('avatar', 'cover') then
    raise exception 'invalid profile media slot' using errcode = '22023';
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

  if p_slot = 'avatar' then
    update public.profiles
    set avatar_path = null
    where id = current_profile.id
    returning * into updated_profile;
  else
    update public.profiles
    set cover_path = null
    where id = current_profile.id
    returning * into updated_profile;
  end if;

  return updated_profile;
end;
$$;

ALTER FUNCTION "public"."remove_my_profile_media"("p_slot" "text") OWNER TO "postgres";

-- 계정 탈퇴. 게시물·댓글·반응·메시지가 프로필을 CASCADE 없이 가리키고 "탈퇴한 사용자" 명의로
-- 남아야 하므로 프로필 행은 지우지 않고 익명화해 묘비로 남긴다. 나머지 개인 정보와 Auth 계정은
-- 한 트랜잭션에서 지운다(삭제 및 보존 정책 §5.3). Auth 계정 삭제에 `auth.users` 권한이 필요해
-- definer다. 정지 중이어도 막지 않으며, 그룹 소유자와 앱 관리자는 먼저 넘기거나 강등돼야 한다.
CREATE OR REPLACE FUNCTION "public"."withdraw_account"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."withdraw_account"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."prepare_profile_media"("p_slot" "public"."profile_media_slot", "p_size_bytes" bigint, "p_width" integer, "p_height" integer, "p_activity_size_bytes" bigint DEFAULT NULL::bigint, "p_activity_width" integer DEFAULT NULL::integer, "p_activity_height" integer DEFAULT NULL::integer) RETURNS TABLE("media_id" "uuid", "object_path" "text", "activity_media_id" "uuid", "activity_object_path" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  owner_profile_id bigint;
  created_id uuid := gen_random_uuid();
  created_activity_id uuid;
begin
  select profile.id
  into owner_profile_id
  from public.profiles as profile
  where profile.auth_user_id = caller_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id);

  if owner_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  if p_slot = 'avatar' then
    if p_activity_size_bytes is null or p_activity_width is null or p_activity_height is null then
      raise exception 'avatar activity rendition required' using errcode = '22023';
    end if;
    created_activity_id := gen_random_uuid();

    insert into public.profile_media_activity_objects (
      id, profile_id, auth_user_id, object_path, size_bytes, width, height
    ) values (
      created_activity_id,
      owner_profile_id,
      caller_id,
      caller_id::text || '/avatar/' || created_activity_id::text,
      p_activity_size_bytes,
      p_activity_width,
      p_activity_height
    );
  elsif p_activity_size_bytes is not null or p_activity_width is not null or p_activity_height is not null then
    raise exception 'cover media does not use an activity rendition' using errcode = '22023';
  end if;

  insert into public.profile_media_objects (
    id, profile_id, auth_user_id, slot, object_path, size_bytes, width, height, activity_media_id
  ) values (
    created_id,
    owner_profile_id,
    caller_id,
    p_slot,
    caller_id::text || '/' || p_slot::text || '/' || created_id::text,
    p_size_bytes,
    p_width,
    p_height,
    created_activity_id
  );

  return query select created_id,
    caller_id::text || '/' || p_slot::text || '/' || created_id::text,
    created_activity_id,
    case when created_activity_id is not null
      then caller_id::text || '/avatar/' || created_activity_id::text
    end;
end;
$$;

ALTER FUNCTION "public"."prepare_profile_media"("p_slot" "public"."profile_media_slot", "p_size_bytes" bigint, "p_width" integer, "p_height" integer, "p_activity_size_bytes" bigint, "p_activity_width" integer, "p_activity_height" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."finalize_profile_media"("p_media_id" "uuid") RETURNS "public"."profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  media public.profile_media_objects;
  activity_media public.profile_media_activity_objects;
  object_record storage.objects;
  activity_object_record storage.objects;
  current_profile public.profiles;
  updated_profile public.profiles;
  activity_post_id uuid := gen_random_uuid();
  activity_kind public.profile_media_activity_kind;
begin
  select item.* into media
  from public.profile_media_objects as item
  where item.id = p_media_id
  for update;

  if media.id is null or media.auth_user_id is distinct from caller_id then
    raise exception 'profile media owner required' using errcode = '42501';
  end if;
  if media.status <> 'pending' then
    raise exception 'profile media is not pending' using errcode = '55000';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.id = media.profile_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id)
  for update;

  if current_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select object.* into object_record
  from storage.objects as object
  where object.bucket_id = 'profile-media'
    and object.name = media.object_path;

  if object_record.id is null then
    raise exception 'uploaded object not found' using errcode = 'P0002';
  end if;
  if object_record.owner_id is distinct from caller_id::text then
    raise exception 'uploaded object owner does not match' using errcode = '42501';
  end if;
  if nullif(object_record.metadata ->> 'size', '')::bigint is distinct from media.size_bytes
    or object_record.metadata ->> 'mimetype' is distinct from 'image/webp' then
    raise exception 'uploaded object metadata does not match' using errcode = '22023';
  end if;

  if media.slot = 'avatar' and media.activity_media_id is null then
    raise exception 'avatar activity media required' using errcode = '55000';
  end if;

  if media.activity_media_id is not null then
    select item.* into activity_media
    from public.profile_media_activity_objects as item
    where item.id = media.activity_media_id
    for update;

    if activity_media.id is null
      or activity_media.profile_id is distinct from media.profile_id
      or activity_media.auth_user_id is distinct from caller_id
      or activity_media.status <> 'pending' then
      raise exception 'profile activity media is not pending' using errcode = '55000';
    end if;

    select object.* into activity_object_record
    from storage.objects as object
    where object.bucket_id = 'profile-media'
      and object.name = activity_media.object_path;

    if activity_object_record.id is null then
      raise exception 'uploaded activity object not found' using errcode = 'P0002';
    end if;
    if activity_object_record.owner_id is distinct from caller_id::text then
      raise exception 'uploaded activity object owner does not match' using errcode = '42501';
    end if;
    if nullif(activity_object_record.metadata ->> 'size', '')::bigint is distinct from activity_media.size_bytes
      or activity_object_record.metadata ->> 'mimetype' is distinct from 'image/webp' then
      raise exception 'uploaded activity object metadata does not match' using errcode = '22023';
    end if;
  end if;

  update public.profile_media_objects
  set status = 'ready', ready_at = now()
  where id = media.id;

  if activity_media.id is not null then
    update public.profile_media_activity_objects
    set status = 'ready', ready_at = now()
    where id = activity_media.id;
  end if;

  if media.slot = 'avatar' then
    activity_kind := 'avatar_changed';
    update public.profiles
    set avatar_path = media.object_path
    where id = current_profile.id
    returning * into updated_profile;
  else
    activity_kind := 'cover_changed';
    update public.profiles
    set cover_path = media.object_path
    where id = current_profile.id
    returning * into updated_profile;
  end if;

  insert into public.posts (
    id,
    kind,
    body,
    timeline_profile_id,
    author_identity,
    display_author_profile_id,
    visibility,
    published_at,
    activity_kind,
    activity_media_path
  ) values (
    activity_post_id,
    'profile',
    '',
    current_profile.id,
    'identified',
    current_profile.id,
    'public',
    now(),
    activity_kind,
    coalesce(activity_media.object_path, media.object_path)
  );

  insert into private.post_authors (post_id, profile_id)
  values (activity_post_id, current_profile.id);

  return updated_profile;
end;
$$;

ALTER FUNCTION "public"."finalize_profile_media"("p_media_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."current_terms_version"() RETURNS "date"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  -- 시행 중인 이용약관의 시행일. 약관을 개정하면 docs/legal/terms_of_service.md의 시행일과
  -- 앱의 TERMS_VERSION을 함께 올린다.
  select date '2026-10-20';
$$;

ALTER FUNCTION "private"."current_terms_version"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."agree_to_terms"("p_version" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_version is distinct from private.current_terms_version() then
    raise exception 'current terms agreement required' using errcode = '22023';
  end if;

  -- 시행 전에 가입한 회원이 처음 동의하는 경로다. 이미 동의했으면 처음 기록을 그대로 둔다.
  update public.profiles
  set terms_version = p_version, terms_agreed_at = now()
  where auth_user_id = (select auth.uid())
    and deleted_at is null
    and terms_agreed_at is null;
end;
$$;

ALTER FUNCTION "public"."agree_to_terms"("p_version" "date") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."submit_my_profile"("p_name" "text", "p_type" "public"."profile_type", "p_student_number" "text" DEFAULT NULL::"text", "p_class_no" smallint DEFAULT NULL::smallint, "p_cohort" smallint DEFAULT NULL::smallint, "p_gender" "public"."profile_gender" DEFAULT NULL::"public"."profile_gender", "p_academic_track" "public"."profile_academic_track" DEFAULT NULL::"public"."profile_academic_track", "p_phone_number" "text" DEFAULT NULL::"text", "p_birthday" "date" DEFAULT NULL::"date", "p_dorm_room" smallint DEFAULT NULL::smallint, "p_terms_version" "date" DEFAULT NULL::"date") RETURNS "public"."profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  existing_profile public.profiles;
  submitted_profile public.profiles;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.users
    where id = caller_id
      and email_confirmed_at is not null
  ) then
    raise exception 'email confirmation required' using errcode = '42501';
  end if;

  -- 가입 신청은 이용약관 계약을 맺는 시점이라, 화면에서 본 판이 시행 중인 판과 같아야 한다.
  if p_terms_version is distinct from private.current_terms_version() then
    raise exception 'current terms agreement required' using errcode = '22023';
  end if;

  select profile.*
  into existing_profile
  from public.profiles as profile
  where profile.auth_user_id = caller_id
  for update;

  if found and existing_profile.status <> 'draft' then
    raise exception 'profile cannot be submitted in its current state'
      using errcode = '55000';
  end if;

  if existing_profile.id is null then
    insert into public.profiles (
      auth_user_id, name, type, student_number, class_no, cohort, gender,
      academic_track, phone_number, birthday, dorm_room, terms_version,
      terms_agreed_at
    )
    values (
      caller_id, btrim(p_name), p_type, nullif(btrim(p_student_number), ''),
      p_class_no, p_cohort, p_gender, p_academic_track,
      nullif(btrim(p_phone_number), ''), p_birthday, p_dorm_room,
      p_terms_version, now()
    )
    returning * into submitted_profile;
  else
    update public.profiles
    set
      name = btrim(p_name),
      type = p_type,
      student_number = nullif(btrim(p_student_number), ''),
      class_no = p_class_no,
      cohort = p_cohort,
      gender = p_gender,
      academic_track = p_academic_track,
      phone_number = nullif(btrim(p_phone_number), ''),
      birthday = p_birthday,
      dorm_room = p_dorm_room,
      terms_version = p_terms_version,
      terms_agreed_at = now(),
      status = 'pending',
      submitted_at = now(),
      status_updated_at = now(),
      status_updated_by = null,
      deleted_at = null
    where id = existing_profile.id
    returning * into submitted_profile;
  end if;

  return submitted_profile;
end;
$$;

ALTER FUNCTION "public"."submit_my_profile"("p_name" "text", "p_type" "public"."profile_type", "p_student_number" "text", "p_class_no" smallint, "p_cohort" smallint, "p_gender" "public"."profile_gender", "p_academic_track" "public"."profile_academic_track", "p_phone_number" "text", "p_birthday" "date", "p_dorm_room" smallint, "p_terms_version" "date") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."update_my_profile"("p_name" "text", "p_description" "text" DEFAULT NULL::"text", "p_birthday" "date" DEFAULT NULL::"date", "p_phone_number" "text" DEFAULT NULL::"text", "p_contact_email" "text" DEFAULT NULL::"text", "p_gender" "public"."profile_gender" DEFAULT NULL::"public"."profile_gender", "p_cohort" smallint DEFAULT NULL::smallint, "p_academic_track" "public"."profile_academic_track" DEFAULT NULL::"public"."profile_academic_track", "p_department" "text" DEFAULT NULL::"text", "p_class_no" smallint DEFAULT NULL::smallint, "p_dorm_room" smallint DEFAULT NULL::smallint, "p_allow_timeline_posts" boolean DEFAULT true, "p_is_returning_student" boolean DEFAULT false, "p_pub_id" "text" DEFAULT NULL::"text") RETURNS "public"."profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."update_my_profile"("p_name" "text", "p_description" "text", "p_birthday" "date", "p_phone_number" "text", "p_contact_email" "text", "p_gender" "public"."profile_gender", "p_cohort" smallint, "p_academic_track" "public"."profile_academic_track", "p_department" "text", "p_class_no" smallint, "p_dorm_room" smallint, "p_allow_timeline_posts" boolean, "p_is_returning_student" boolean, "p_pub_id" "text") OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."profile_media_objects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" bigint NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "slot" "public"."profile_media_slot" NOT NULL,
    "object_path" "text" NOT NULL,
    "size_bytes" bigint NOT NULL,
    "width" integer NOT NULL,
    "height" integer NOT NULL,
    "activity_media_id" "uuid",
    "status" "public"."profile_media_status" DEFAULT 'pending'::"public"."profile_media_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ready_at" timestamp with time zone,
    CONSTRAINT "profile_media_dimensions_check" CHECK ((((("slot" = 'avatar'::"public"."profile_media_slot") AND ("width" = "height") AND ("width" >= 1) AND ("width" <= 512))) OR (("slot" = 'cover'::"public"."profile_media_slot") AND ("width" >= 3) AND ("width" <= 2400) AND ("width" >= ("height" * 2))))),
    CONSTRAINT "profile_media_path_check" CHECK (("object_path" = (((("auth_user_id")::"text" || '/'::"text") || ("slot")::"text") || '/'::"text") || ("id")::"text")),
    CONSTRAINT "profile_media_size_check" CHECK ((("size_bytes" >= 1) AND ("size_bytes" <=
CASE "slot"
    WHEN 'avatar'::"public"."profile_media_slot" THEN 1048576
    ELSE 4194304
END))),
    CONSTRAINT "profile_media_status_timestamps_check" CHECK (((("status" = 'pending'::"public"."profile_media_status") AND ("ready_at" IS NULL)) OR (("status" = 'ready'::"public"."profile_media_status") AND ("ready_at" IS NOT NULL))))
);

ALTER TABLE "public"."profile_media_objects" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."profile_media_activity_objects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" bigint NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "object_path" "text" NOT NULL,
    "size_bytes" bigint NOT NULL,
    "width" integer NOT NULL,
    "height" integer NOT NULL,
    "status" "public"."profile_media_status" DEFAULT 'pending'::"public"."profile_media_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ready_at" timestamp with time zone,
    CONSTRAINT "profile_media_activity_dimensions_check" CHECK ((("width" = "height") AND ("width" >= 1) AND ("width" <= 2048))),
    CONSTRAINT "profile_media_activity_path_check" CHECK (("object_path" = ((("auth_user_id")::"text" || '/avatar/'::"text") || ("id")::"text"))),
    CONSTRAINT "profile_media_activity_size_check" CHECK ((("size_bytes" >= 1) AND ("size_bytes" <= 4194304))),
    CONSTRAINT "profile_media_activity_status_timestamps_check" CHECK ((("status" = 'pending'::"public"."profile_media_status") AND ("ready_at" IS NULL)) OR (("status" = 'ready'::"public"."profile_media_status") AND ("ready_at" IS NOT NULL)))
);

ALTER TABLE "public"."profile_media_activity_objects" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."profile_departments" (
    "name" "text" NOT NULL,
    "sort_order" smallint NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    CONSTRAINT "profile_departments_name_length" CHECK ((("char_length"("btrim"("name")) >= 1) AND ("char_length"("btrim"("name")) <= 100))),
    CONSTRAINT "profile_departments_sort_order_range" CHECK (("sort_order" >= 0))
);

ALTER TABLE "public"."profile_departments" OWNER TO "postgres";

ALTER TABLE "public"."profiles" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."profiles_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY "public"."profile_media_objects"
    ADD CONSTRAINT "profile_media_objects_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."profile_media_objects"
    ADD CONSTRAINT "profile_media_objects_object_path_key" UNIQUE ("object_path");

ALTER TABLE ONLY "public"."profile_media_activity_objects"
    ADD CONSTRAINT "profile_media_activity_objects_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."profile_media_activity_objects"
    ADD CONSTRAINT "profile_media_activity_objects_object_path_key" UNIQUE ("object_path");

ALTER TABLE ONLY "public"."profile_departments"
    ADD CONSTRAINT "profile_departments_pkey" PRIMARY KEY ("name");

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_auth_user_id_key" UNIQUE ("auth_user_id");

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_student_number_key" UNIQUE ("student_number");

CREATE INDEX "profiles_active_student_cohort_idx" ON "public"."profiles" USING "btree" ("cohort") WHERE (("type" = 'student'::"public"."profile_type") AND ("status" = 'accepted'::"public"."profile_status") AND ("deleted_at" IS NULL));

CREATE UNIQUE INDEX "profiles_pub_id_case_insensitive_key" ON "public"."profiles" USING "btree" ("lower"("pub_id"));

CREATE INDEX "profiles_search_name_trgm_idx" ON "public"."profiles" USING "gin" ("search_name" "extensions"."gin_trgm_ops") WHERE (("status" = 'accepted'::"public"."profile_status") AND ("deleted_at" IS NULL));

CREATE INDEX "profiles_status_idx" ON "public"."profiles" USING "btree" ("status") WHERE ("deleted_at" IS NULL);

CREATE INDEX "profiles_status_updated_by_idx" ON "public"."profiles" USING "btree" ("status_updated_by") WHERE ("status_updated_by" IS NOT NULL);

CREATE OR REPLACE TRIGGER "profiles_set_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_status_updated_by_fkey" FOREIGN KEY ("status_updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."profile_media_objects"
    ADD CONSTRAINT "profile_media_objects_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."profile_media_activity_objects"
    ADD CONSTRAINT "profile_media_activity_objects_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."profile_media_objects"
    ADD CONSTRAINT "profile_media_objects_activity_media_id_fkey" FOREIGN KEY ("activity_media_id") REFERENCES "public"."profile_media_activity_objects"("id") ON DELETE SET NULL;

-- 정리 큐로 옮길 후보를 훑는 인덱스. `ready` 행은 참조가 끊긴 순간부터 대상이 되므로 상태로
-- 좁히지 않고 생성 순서만 유지한다.
CREATE INDEX "profile_media_objects_cleanup_idx" ON "public"."profile_media_objects" USING "btree" ("created_at", "id");

CREATE INDEX "profile_media_activity_objects_cleanup_idx" ON "public"."profile_media_activity_objects" USING "btree" ("created_at", "id");

ALTER TABLE "public"."profile_media_objects" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_media_objects_deny_client_access" ON "public"."profile_media_objects" USING (false) WITH CHECK (false);

ALTER TABLE "public"."profile_media_activity_objects" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_media_activity_objects_deny_client_access" ON "public"."profile_media_activity_objects" USING (false) WITH CHECK (false);

ALTER TABLE "public"."profile_departments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_departments_select_active" ON "public"."profile_departments" FOR SELECT TO "authenticated" USING ("is_active");

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

-- 읽는 사람도 앱을 쓸 수 있어야 한다. 승인 대기·차단·이용 정지(§16.11)된 사람은 자기 행만 읽는다.
CREATE POLICY "profiles_select_accepted" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("status" = 'accepted'::"public"."profile_status") AND ("deleted_at" IS NULL) AND (( SELECT "private"."current_profile_id"() AS "current_profile_id") IS NOT NULL)));

CREATE POLICY "profiles_select_own" ON "public"."profiles" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "auth_user_id") AND ("deleted_at" IS NULL)));

REVOKE ALL ON FUNCTION "private"."can_read_profile_media_path"("p_object_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_read_profile_media_path"("p_object_path" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "private"."generate_profile_pub_id"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."can_upload_profile_media"("p_object_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_upload_profile_media"("p_object_path" "text") TO "authenticated";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "service_role";
REVOKE SELECT ON TABLE "public"."profiles" FROM "authenticated";
GRANT SELECT ("id", "pub_id", "name", "role", "type", "student_number", "class_no", "cohort", "gender", "academic_track", "phone_number", "avatar_path", "birthday", "description", "dorm_room", "allow_timeline_posts", "cover_path", "contact_email", "department", "is_returning_student") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_my_profile"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_profile"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_accepted_profile"("p_pub_id" "text") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."get_accepted_profile"("p_pub_id" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_birthdays"("p_reference_date" "date", "p_scope" "text") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."list_birthdays"("p_reference_date" "date", "p_scope" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."remove_my_profile_media"("p_slot" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_my_profile_media"("p_slot" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."withdraw_account"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."withdraw_account"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."prepare_profile_media"("p_slot" "public"."profile_media_slot", "p_size_bytes" bigint, "p_width" integer, "p_height" integer, "p_activity_size_bytes" bigint, "p_activity_width" integer, "p_activity_height" integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."prepare_profile_media"("p_slot" "public"."profile_media_slot", "p_size_bytes" bigint, "p_width" integer, "p_height" integer, "p_activity_size_bytes" bigint, "p_activity_width" integer, "p_activity_height" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."finalize_profile_media"("p_media_id" "uuid") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."finalize_profile_media"("p_media_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "private"."current_terms_version"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."agree_to_terms"("p_version" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."agree_to_terms"("p_version" "date") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."submit_my_profile"("p_name" "text", "p_type" "public"."profile_type", "p_student_number" "text", "p_class_no" smallint, "p_cohort" smallint, "p_gender" "public"."profile_gender", "p_academic_track" "public"."profile_academic_track", "p_phone_number" "text", "p_birthday" "date", "p_dorm_room" smallint, "p_terms_version" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_my_profile"("p_name" "text", "p_type" "public"."profile_type", "p_student_number" "text", "p_class_no" smallint, "p_cohort" smallint, "p_gender" "public"."profile_gender", "p_academic_track" "public"."profile_academic_track", "p_phone_number" "text", "p_birthday" "date", "p_dorm_room" smallint, "p_terms_version" "date") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_my_profile"("p_name" "text", "p_description" "text", "p_birthday" "date", "p_phone_number" "text", "p_contact_email" "text", "p_gender" "public"."profile_gender", "p_cohort" smallint, "p_academic_track" "public"."profile_academic_track", "p_department" "text", "p_class_no" smallint, "p_dorm_room" smallint, "p_allow_timeline_posts" boolean, "p_is_returning_student" boolean, "p_pub_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_my_profile"("p_name" "text", "p_description" "text", "p_birthday" "date", "p_phone_number" "text", "p_contact_email" "text", "p_gender" "public"."profile_gender", "p_cohort" smallint, "p_academic_track" "public"."profile_academic_track", "p_department" "text", "p_class_no" smallint, "p_dorm_room" smallint, "p_allow_timeline_posts" boolean, "p_is_returning_student" boolean, "p_pub_id" "text") TO "authenticated";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profile_departments" TO "service_role";
GRANT SELECT ON TABLE "public"."profile_departments" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."profiles_id_seq" FROM "anon", "authenticated", "service_role";
GRANT USAGE ON SEQUENCE "public"."profiles_id_seq" TO "service_role";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."profiles" FROM "anon", "authenticated";

-- 클라이언트는 이 테이블을 직접 읽거나 쓰지 않는다. prepare/finalize RPC와 Storage 정책이
-- 유일한 통로다.
REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."profile_media_objects" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."profile_media_objects" FROM "anon", "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profile_media_objects" TO "service_role";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."profile_media_activity_objects" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."profile_media_activity_objects" FROM "anon", "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profile_media_activity_objects" TO "service_role";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."profile_departments" FROM "anon", "authenticated";
