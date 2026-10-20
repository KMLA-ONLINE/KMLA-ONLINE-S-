-- 이용약관 동의 기록과 선택 정보 전환. 제약은 완화만 하고 새 컬럼은 nullable이라 기존 행을
-- 그대로 통과시킨다. 기존 회원의 동의 기록은 비워 두고 첫 접속 때 받는다.
SET local check_function_bodies = off;

ALTER TABLE "public"."profiles"
  DROP CONSTRAINT "profiles_type_details";

DROP FUNCTION "public"."submit_my_profile"(text, public.profile_type, text, smallint, smallint, public.profile_gender, public.profile_academic_track, text, date, smallint);

ALTER TABLE "public"."profiles"
  ADD COLUMN "terms_version" date;

ALTER TABLE "public"."profiles"
  ADD COLUMN "terms_agreed_at" timestamp WITH time zone;

CREATE OR REPLACE FUNCTION private.current_terms_version()
  RETURNS date
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  -- 시행 중인 이용약관의 시행일. 약관을 개정하면 docs/legal/terms_of_service.md의 시행일과
  -- 앱의 TERMS_VERSION을 함께 올린다.
  select date '2026-10-20';
$function$;

CREATE OR REPLACE FUNCTION public.agree_to_terms (
  p_version date
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "public"."agree_to_terms"(date) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.submit_my_profile (
  p_name           text,
  p_type           public.profile_type,
  p_student_number text                          DEFAULT NULL::text,
  p_class_no       smallint                      DEFAULT NULL::smallint,
  p_cohort         smallint                      DEFAULT NULL::smallint,
  p_gender         public.profile_gender         DEFAULT NULL::public.profile_gender,
  p_academic_track public.profile_academic_track DEFAULT NULL::public.profile_academic_track,
  p_phone_number   text                          DEFAULT NULL::text,
  p_birthday       date                          DEFAULT NULL::date,
  p_dorm_room      smallint                      DEFAULT NULL::smallint,
  p_terms_version  date                          DEFAULT NULL::date
)
  RETURNS public.profiles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL
  ON FUNCTION "public"."submit_my_profile"(text, public.profile_type, text, smallint, smallint, public.profile_gender, public.profile_academic_track, text, date, smallint, date)
  FROM PUBLIC, "anon", "service_role";

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
  p_pub_id               text                          DEFAULT NULL::text
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
$function$;

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_terms_agreement" CHECK (((terms_version IS NULL) = (terms_agreed_at IS NULL)));

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_type_details" CHECK (((status = 'withdrawn'::public.profile_status) OR ((type = 'student'::public.profile_type) AND (student_number IS NOT NULL) AND (cohort IS
    NOT NULL)) OR ((type = 'alumni'::public.profile_type) AND (cohort IS
    NOT NULL) AND (class_no IS NULL) AND (dorm_room IS NULL)) OR
    ((type = 'teacher'::public.profile_type) AND (student_number IS NULL) AND (class_no IS NULL) AND (cohort IS NULL) AND (gender IS NULL) AND (academic_track IS NULL) AND
    (dorm_room IS NULL))));

REVOKE ALL ON FUNCTION "private"."current_terms_version"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."agree_to_terms"(date) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."agree_to_terms"(date) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."agree_to_terms"(date) TO "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."submit_my_profile"(text, public.profile_type, text, smallint, smallint, public.profile_gender, public.profile_academic_track, text, date, smallint, date)
  TO "authenticated";

REVOKE ALL
  ON FUNCTION "public"."submit_my_profile"(text, public.profile_type, text, smallint, smallint, public.profile_gender, public.profile_academic_track, text, date, smallint, date)
  FROM "postgres";

GRANT EXECUTE
  ON FUNCTION "public"."submit_my_profile"(text, public.profile_type, text, smallint, smallint, public.profile_gender, public.profile_academic_track, text, date, smallint, date)
  TO "postgres";
