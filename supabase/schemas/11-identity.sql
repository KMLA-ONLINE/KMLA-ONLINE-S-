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

CREATE OR REPLACE FUNCTION "private"."can_delete_own_profile_media_path"("p_object_path" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.is_own_profile_media_path(p_object_path)
    and not exists (
      select 1
      from public.profiles as profile
      where p_object_path in (profile.avatar_path, profile.cover_path)
    )
    and not exists (
      select 1
      from public.posts as post
      where post.activity_media_path = p_object_path
        and post.deleted_at is null
    );
$$;

ALTER FUNCTION "private"."can_delete_own_profile_media_path"("p_object_path" "text") OWNER TO "postgres";

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

CREATE OR REPLACE FUNCTION "private"."is_own_profile_media_path"("p_object_path" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select p_object_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(avatar|cover)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and split_part(p_object_path, '/', 1) = auth.uid()::text
  and exists (
    select 1
    from public.profiles as profile
    where profile.auth_user_id = auth.uid()
      and profile.status = 'accepted'
      and profile.deleted_at is null
  );
$$;

ALTER FUNCTION "private"."is_own_profile_media_path"("p_object_path" "text") OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" bigint NOT NULL,
    "auth_user_id" "uuid",
    "pub_id" "text" DEFAULT "private"."generate_profile_pub_id"() NOT NULL,
    "name" "text" NOT NULL,
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

CREATE OR REPLACE FUNCTION "public"."set_my_profile_media"("p_slot" "text", "p_object_path" "text") RETURNS "public"."profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_id uuid := auth.uid();
  current_profile public.profiles;
  updated_profile public.profiles;
  activity_post_id uuid := gen_random_uuid();
  activity_kind public.profile_media_activity_kind;
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

  if not private.is_own_profile_media_path(p_object_path)
    or split_part(p_object_path, '/', 2) <> p_slot then
    raise exception 'invalid profile media path' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = 'profile-media'
      and object.name = p_object_path
      and object.owner_id = caller_id::text
  ) then
    raise exception 'uploaded profile media required' using errcode = '22023';
  end if;

  if (p_slot = 'avatar' and current_profile.avatar_path = p_object_path)
    or (p_slot = 'cover' and current_profile.cover_path = p_object_path) then
    return current_profile;
  end if;

  if p_slot = 'avatar' then
    activity_kind := 'avatar_changed';
    update public.profiles
    set avatar_path = p_object_path
    where id = current_profile.id
    returning * into updated_profile;
  else
    activity_kind := 'cover_changed';
    update public.profiles
    set cover_path = p_object_path
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
    p_object_path
  );

  insert into private.post_authors (post_id, profile_id)
  values (activity_post_id, current_profile.id);

  return updated_profile;
end;
$$;

ALTER FUNCTION "public"."set_my_profile_media"("p_slot" "text", "p_object_path" "text") OWNER TO "postgres";

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

CREATE OR REPLACE FUNCTION "public"."update_my_profile"("p_name" "text", "p_description" "text" DEFAULT NULL::"text", "p_birthday" "date" DEFAULT NULL::"date", "p_phone_number" "text" DEFAULT NULL::"text", "p_contact_email" "text" DEFAULT NULL::"text", "p_gender" "public"."profile_gender" DEFAULT NULL::"public"."profile_gender", "p_cohort" smallint DEFAULT NULL::smallint, "p_academic_track" "public"."profile_academic_track" DEFAULT NULL::"public"."profile_academic_track", "p_department" "text" DEFAULT NULL::"text", "p_class_no" smallint DEFAULT NULL::smallint, "p_dorm_room" smallint DEFAULT NULL::smallint, "p_allow_timeline_posts" boolean DEFAULT true, "p_is_returning_student" boolean DEFAULT false) RETURNS "public"."profiles"
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

ALTER FUNCTION "public"."update_my_profile"("p_name" "text", "p_description" "text", "p_birthday" "date", "p_phone_number" "text", "p_contact_email" "text", "p_gender" "public"."profile_gender", "p_cohort" smallint, "p_academic_track" "public"."profile_academic_track", "p_department" "text", "p_class_no" smallint, "p_dorm_room" smallint, "p_allow_timeline_posts" boolean, "p_is_returning_student" boolean) OWNER TO "postgres";

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

CREATE INDEX "profiles_status_idx" ON "public"."profiles" USING "btree" ("status") WHERE ("deleted_at" IS NULL);

CREATE INDEX "profiles_status_updated_by_idx" ON "public"."profiles" USING "btree" ("status_updated_by") WHERE ("status_updated_by" IS NOT NULL);

CREATE OR REPLACE TRIGGER "profiles_set_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_status_updated_by_fkey" FOREIGN KEY ("status_updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;

ALTER TABLE "public"."profile_departments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_departments_select_active" ON "public"."profile_departments" FOR SELECT TO "authenticated" USING ("is_active");

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_accepted" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("status" = 'accepted'::"public"."profile_status") AND ("deleted_at" IS NULL)));

CREATE POLICY "profiles_select_own" ON "public"."profiles" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "auth_user_id") AND ("deleted_at" IS NULL)));

REVOKE ALL ON FUNCTION "private"."can_delete_own_profile_media_path"("p_object_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_delete_own_profile_media_path"("p_object_path" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "private"."can_read_profile_media_path"("p_object_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_read_profile_media_path"("p_object_path" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "private"."generate_profile_pub_id"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."is_own_profile_media_path"("p_object_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_own_profile_media_path"("p_object_path" "text") TO "authenticated";

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

REVOKE ALL ON FUNCTION "public"."set_my_profile_media"("p_slot" "text", "p_object_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_my_profile_media"("p_slot" "text", "p_object_path" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."submit_my_profile"("p_name" "text", "p_type" "public"."profile_type", "p_student_number" "text", "p_class_no" smallint, "p_cohort" smallint, "p_gender" "public"."profile_gender", "p_academic_track" "public"."profile_academic_track", "p_phone_number" "text", "p_birthday" "date", "p_dorm_room" smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_my_profile"("p_name" "text", "p_type" "public"."profile_type", "p_student_number" "text", "p_class_no" smallint, "p_cohort" smallint, "p_gender" "public"."profile_gender", "p_academic_track" "public"."profile_academic_track", "p_phone_number" "text", "p_birthday" "date", "p_dorm_room" smallint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_my_profile"("p_name" "text", "p_description" "text", "p_birthday" "date", "p_phone_number" "text", "p_contact_email" "text", "p_gender" "public"."profile_gender", "p_cohort" smallint, "p_academic_track" "public"."profile_academic_track", "p_department" "text", "p_class_no" smallint, "p_dorm_room" smallint, "p_allow_timeline_posts" boolean, "p_is_returning_student" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_my_profile"("p_name" "text", "p_description" "text", "p_birthday" "date", "p_phone_number" "text", "p_contact_email" "text", "p_gender" "public"."profile_gender", "p_cohort" smallint, "p_academic_track" "public"."profile_academic_track", "p_department" "text", "p_class_no" smallint, "p_dorm_room" smallint, "p_allow_timeline_posts" boolean, "p_is_returning_student" boolean) TO "authenticated";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profile_departments" TO "service_role";
GRANT SELECT ON TABLE "public"."profile_departments" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."profiles_id_seq" FROM "anon", "authenticated", "service_role";
GRANT USAGE ON SEQUENCE "public"."profiles_id_seq" TO "service_role";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."profiles" FROM "anon", "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."profile_departments" FROM "anon", "authenticated";
