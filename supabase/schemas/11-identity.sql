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
        and post.deleted_at is null
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
    CONSTRAINT "profiles_type_details" CHECK (((("type" = 'student'::"public"."profile_type") AND ("student_number" IS NOT NULL) AND ("birthday" IS NOT NULL) AND ("cohort" IS NOT NULL) AND ("gender" IS NOT NULL) AND ("academic_track" IS NOT NULL)) OR (("type" = 'alumni'::"public"."profile_type") AND ("cohort" IS NOT NULL) AND ("gender" IS NOT NULL) AND ("academic_track" IS NOT NULL) AND ("class_no" IS NULL) AND ("dorm_room" IS NULL)) OR (("type" = 'teacher'::"public"."profile_type") AND ("student_number" IS NULL) AND ("class_no" IS NULL) AND ("cohort" IS NULL) AND ("gender" IS NULL) AND ("academic_track" IS NULL) AND ("dorm_room" IS NULL))))
);

ALTER TABLE "public"."profiles" OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_my_profile"() RETURNS SETOF "public"."profiles"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select profile.*
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.deleted_at is null;
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
    );
$$;

ALTER FUNCTION "public"."get_accepted_profile"("p_pub_id" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_birthdays"("p_reference_date" "date", "p_scope" "text" DEFAULT 'month'::"text") RETURNS TABLE("pub_id" "text", "name" "text", "avatar_path" "text", "birthday_month" smallint, "birthday_day" smallint, "birthday_date" "date")
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
  ) then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  if p_scope = 'today' then
    range_start := p_reference_date;
    range_end := p_reference_date;
  elsif p_scope = 'month' then
    range_start := (p_reference_date - interval '1 month')::date;
    range_end := (p_reference_date + interval '1 month')::date;
  else
    raise exception 'birthday scope must be today or month' using errcode = '22023';
  end if;

  current_cohort := (extract(year from p_reference_date)::integer - 1995)::smallint;

  return query
  with eligible_profiles as (
    select profile.pub_id, profile.name, profile.avatar_path, profile.birthday
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

CREATE OR REPLACE FUNCTION "public"."prepare_profile_media"("p_slot" "public"."profile_media_slot", "p_size_bytes" bigint, "p_width" integer, "p_height" integer) RETURNS TABLE("media_id" "uuid", "object_path" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  owner_profile_id bigint;
  created_id uuid := gen_random_uuid();
begin
  select profile.id
  into owner_profile_id
  from public.profiles as profile
  where profile.auth_user_id = caller_id
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if owner_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  insert into public.profile_media_objects (
    id, profile_id, auth_user_id, slot, object_path, size_bytes, width, height
  ) values (
    created_id,
    owner_profile_id,
    caller_id,
    p_slot,
    caller_id::text || '/' || p_slot::text || '/' || created_id::text,
    p_size_bytes,
    p_width,
    p_height
  );

  return query select created_id,
    caller_id::text || '/' || p_slot::text || '/' || created_id::text;
end;
$$;

ALTER FUNCTION "public"."prepare_profile_media"("p_slot" "public"."profile_media_slot", "p_size_bytes" bigint, "p_width" integer, "p_height" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."finalize_profile_media"("p_media_id" "uuid") RETURNS "public"."profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  media public.profile_media_objects;
  object_record storage.objects;
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

  update public.profile_media_objects
  set status = 'ready', ready_at = now()
  where id = media.id;

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
    media.object_path
  );

  insert into private.post_authors (post_id, profile_id)
  values (activity_post_id, current_profile.id);

  return updated_profile;
end;
$$;

ALTER FUNCTION "public"."finalize_profile_media"("p_media_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."submit_my_profile"("p_name" "text", "p_type" "public"."profile_type", "p_student_number" "text" DEFAULT NULL::"text", "p_class_no" smallint DEFAULT NULL::smallint, "p_cohort" smallint DEFAULT NULL::smallint, "p_gender" "public"."profile_gender" DEFAULT NULL::"public"."profile_gender", "p_academic_track" "public"."profile_academic_track" DEFAULT NULL::"public"."profile_academic_track", "p_phone_number" "text" DEFAULT NULL::"text", "p_birthday" "date" DEFAULT NULL::"date", "p_dorm_room" smallint DEFAULT NULL::smallint) RETURNS "public"."profiles"
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
      academic_track, phone_number, birthday, dorm_room
    )
    values (
      caller_id, btrim(p_name), p_type, nullif(btrim(p_student_number), ''),
      p_class_no, p_cohort, p_gender, p_academic_track,
      nullif(btrim(p_phone_number), ''), p_birthday, p_dorm_room
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

ALTER FUNCTION "public"."submit_my_profile"("p_name" "text", "p_type" "public"."profile_type", "p_student_number" "text", "p_class_no" smallint, "p_cohort" smallint, "p_gender" "public"."profile_gender", "p_academic_track" "public"."profile_academic_track", "p_phone_number" "text", "p_birthday" "date", "p_dorm_room" smallint) OWNER TO "postgres";

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

  if current_profile.type in ('student', 'alumni')
    and (
      p_gender is null
      or p_cohort is null
      or p_academic_track is null
    ) then
    raise exception 'academic profile fields are required'
      using errcode = '22023';
  end if;

  if current_profile.type = 'student' and p_birthday is null then
    raise exception 'student birthday is required'
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

ALTER TABLE ONLY "public"."profile_departments"
    ADD CONSTRAINT "profile_departments_pkey" PRIMARY KEY ("name");

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_auth_user_id_key" UNIQUE ("auth_user_id");

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_student_number_key" UNIQUE ("student_number");

CREATE INDEX "profiles_accepted_students_idx" ON "public"."profiles" USING "btree" ("id") WHERE (("status" = 'accepted'::"public"."profile_status") AND ("type" = 'student'::"public"."profile_type") AND ("deleted_at" IS NULL));

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

-- 정리 큐로 옮길 후보를 훑는 인덱스. `ready` 행은 참조가 끊긴 순간부터 대상이 되므로 상태로
-- 좁히지 않고 생성 순서만 유지한다.
CREATE INDEX "profile_media_objects_cleanup_idx" ON "public"."profile_media_objects" USING "btree" ("created_at", "id");

ALTER TABLE "public"."profile_media_objects" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."profile_departments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_departments_select_active" ON "public"."profile_departments" FOR SELECT TO "authenticated" USING ("is_active");

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_accepted" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("status" = 'accepted'::"public"."profile_status") AND ("deleted_at" IS NULL)));

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

REVOKE ALL ON FUNCTION "public"."prepare_profile_media"("p_slot" "public"."profile_media_slot", "p_size_bytes" bigint, "p_width" integer, "p_height" integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."prepare_profile_media"("p_slot" "public"."profile_media_slot", "p_size_bytes" bigint, "p_width" integer, "p_height" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."finalize_profile_media"("p_media_id" "uuid") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."finalize_profile_media"("p_media_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."submit_my_profile"("p_name" "text", "p_type" "public"."profile_type", "p_student_number" "text", "p_class_no" smallint, "p_cohort" smallint, "p_gender" "public"."profile_gender", "p_academic_track" "public"."profile_academic_track", "p_phone_number" "text", "p_birthday" "date", "p_dorm_room" smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_my_profile"("p_name" "text", "p_type" "public"."profile_type", "p_student_number" "text", "p_class_no" smallint, "p_cohort" smallint, "p_gender" "public"."profile_gender", "p_academic_track" "public"."profile_academic_track", "p_phone_number" "text", "p_birthday" "date", "p_dorm_room" smallint) TO "authenticated";

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

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."profile_departments" FROM "anon", "authenticated";
