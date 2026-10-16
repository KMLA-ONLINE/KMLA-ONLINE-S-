-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.


CREATE OR REPLACE FUNCTION "private"."require_app_admin"() RETURNS bigint
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare
  caller_profile_id bigint;
begin
  select profile.id
  into caller_profile_id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.role = 'admin'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id);

  if caller_profile_id is null then
    raise exception 'app administrator required' using errcode = '42501';
  end if;

  return caller_profile_id;
end;
$$;

ALTER FUNCTION "private"."require_app_admin"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."require_recent_password_auth"() RETURNS "void"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) as method
    where method ->> 'method' = 'password'
      and (method ->> 'timestamp')::numeric
        between extract(epoch from now() - interval '5 minutes')
          and extract(epoch from now())
  ) then
    raise exception 'recent password authentication required' using errcode = '42501';
  end if;
end;
$$;

ALTER FUNCTION "private"."require_recent_password_auth"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_list_accepted_users"("p_query" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0, "p_managers_only" boolean DEFAULT false) RETURNS TABLE("profile_id" bigint, "pub_id" "text", "name" "text", "profile_type" "public"."profile_type", "cohort" smallint, "department" "text", "has_gongang_manage" boolean, "total_count" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform private.require_app_admin();
  if p_limit not between 1 and 200 or p_offset < 0 or p_managers_only is null then
    raise exception 'invalid pagination' using errcode = '22023';
  end if;

  return query
  select
    profile.id, profile.pub_id, profile.name, profile.type, profile.cohort,
    profile.department,
    exists (
      select 1
      from public.profile_permissions as permission
      where permission.profile_id = profile.id
        and permission.permission_key = 'gongang.manage'
    ),
    count(*) over ()
  from public.profiles as profile
  where profile.status = 'accepted'
    and profile.deleted_at is null
    and (
      not p_managers_only
      or exists (
        select 1
        from public.profile_permissions as manager_permission
        where manager_permission.profile_id = profile.id
          and manager_permission.permission_key = 'gongang.manage'
      )
    )
    and (
      nullif(btrim(coalesce(p_query, '')), '') is null
      or profile.name ilike '%' || btrim(p_query) || '%'
      or profile.pub_id ilike '%' || btrim(p_query) || '%'
      or profile.cohort::text = btrim(p_query)
    )
  order by profile.name, profile.id
  limit p_limit
  offset p_offset;
end;
$$;

ALTER FUNCTION "public"."admin_list_accepted_users"("p_query" "text", "p_limit" integer, "p_offset" integer, "p_managers_only" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_list_applications"("p_status" "public"."profile_status", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS TABLE("profile_id" bigint, "name" "text", "profile_type" "public"."profile_type", "is_returning_student" boolean, "submitted_at" timestamp with time zone, "cohort" smallint, "student_number" "text", "gender" "public"."profile_gender", "birthday" "date", "total_count" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform private.require_app_admin();

  if p_status not in ('pending', 'blocked') then
    raise exception 'status must be pending or blocked' using errcode = '22023';
  end if;
  if p_limit not between 1 and 200 or p_offset < 0 then
    raise exception 'invalid pagination' using errcode = '22023';
  end if;

  return query
  select
    profile.id, profile.name, profile.type, profile.is_returning_student,
    profile.submitted_at, profile.cohort, profile.student_number,
    profile.gender, profile.birthday, count(*) over ()
  from public.profiles as profile
  where profile.status = p_status
    and profile.deleted_at is null
  order by
    case when p_status = 'pending' then profile.submitted_at end asc,
    case when p_status = 'blocked' then profile.status_updated_at end desc,
    profile.id asc
  limit p_limit
  offset p_offset;
end;
$$;

ALTER FUNCTION "public"."admin_list_applications"("p_status" "public"."profile_status", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_list_members"("p_query" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0, "p_admins_only" boolean DEFAULT false) RETURNS TABLE("profile_id" bigint, "pub_id" "text", "name" "text", "profile_type" "public"."profile_type", "cohort" smallint, "department" "text", "is_app_admin" boolean, "is_self" boolean, "total_count" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform private.require_app_admin();
  perform private.require_recent_password_auth();
  if p_limit not between 1 and 200 or p_offset < 0 or p_admins_only is null then
    raise exception 'invalid pagination' using errcode = '22023';
  end if;

  return query
  select
    profile.id, profile.pub_id, profile.name, profile.type, profile.cohort,
    profile.department, profile.role = 'admin', profile.auth_user_id = auth.uid(),
    count(*) over ()
  from public.profiles as profile
  where profile.status = 'accepted'
    and profile.deleted_at is null
    and (not p_admins_only or profile.role = 'admin')
    and (
      nullif(btrim(coalesce(p_query, '')), '') is null
      or profile.name ilike '%' || btrim(p_query) || '%'
      or profile.pub_id ilike '%' || btrim(p_query) || '%'
      or profile.cohort::text = btrim(p_query)
    )
  order by (profile.role = 'admin') desc, profile.name, profile.id
  limit p_limit
  offset p_offset;
end;
$$;

ALTER FUNCTION "public"."admin_list_members"("p_query" "text", "p_limit" integer, "p_offset" integer, "p_admins_only" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_list_roster"() RETURNS TABLE("profile_id" bigint, "pub_id" "text", "name" "text", "profile_type" "public"."profile_type", "cohort" smallint, "department" "text", "is_app_admin" boolean, "approved_at" timestamp with time zone, "is_suspended" boolean, "suspension_expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform private.require_app_admin();

  -- 화면이 기수·유형별 인원 수를 세고 필터·정렬·CSV를 브라우저에서 하므로 승인된 사용자 전체를 한 번에 돌려준다.
  return query
  select
    profile.id, profile.pub_id, profile.name, profile.type, profile.cohort,
    profile.department, profile.role = 'admin', profile.status_updated_at,
    suspension.id is not null, suspension.expires_at
  from public.profiles as profile
  left join private.profile_suspensions as suspension
    on suspension.profile_id = profile.id
    and suspension.ended_at is null
    and (suspension.expires_at is null or suspension.expires_at > now())
  where profile.status = 'accepted'
    and profile.deleted_at is null
  order by profile.name, profile.id;
end;
$$;

ALTER FUNCTION "public"."admin_list_roster"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_review_applications"("p_profile_ids" bigint[], "p_status" "public"."profile_status") RETURNS TABLE("profile_id" bigint, "status" "public"."profile_status", "status_updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_profile_id bigint := private.require_app_admin();
  requested_count integer := cardinality(p_profile_ids);
  locked_count integer;
begin
  if p_status not in ('accepted', 'blocked') then
    raise exception 'status must be accepted or blocked' using errcode = '22023';
  end if;
  if requested_count is null or requested_count not between 1 and 200 then
    raise exception 'between 1 and 200 applications are required' using errcode = '22023';
  end if;
  if requested_count <> (select count(distinct id) from unnest(p_profile_ids) as id)
    or array_position(p_profile_ids, null) is not null then
    raise exception 'application ids must be unique and nonnull' using errcode = '22023';
  end if;

  select count(*)
  into locked_count
  from (
    select profile.id
    from public.profiles as profile
    where profile.id = any(p_profile_ids)
      and profile.status = 'pending'
      and profile.deleted_at is null
    for update
  ) as locked_profiles;

  if locked_count <> requested_count then
    raise exception 'all applications must be pending' using errcode = '55000';
  end if;

  return query
  update public.profiles as profile
  set
    status = p_status,
    status_updated_at = now(),
    status_updated_by = caller_profile_id
  where profile.id = any(p_profile_ids)
  returning profile.id, profile.status, profile.status_updated_at;
end;
$$;

ALTER FUNCTION "public"."admin_review_applications"("p_profile_ids" bigint[], "p_status" "public"."profile_status") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_set_app_admin"("p_profile_id" bigint, "p_enabled" boolean) RETURNS TABLE("profile_id" bigint, "is_app_admin" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  target_role public.app_role;
begin
  perform pg_advisory_xact_lock(hashtextextended('app-admin-role-mutations', 0));
  perform private.require_app_admin();
  perform private.require_recent_password_auth();

  if p_enabled is null then
    raise exception 'enabled must not be null' using errcode = '22023';
  end if;

  select profile.role
  into target_role
  from public.profiles as profile
  where profile.id = p_profile_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
  for update;

  if target_role is null then
    raise exception 'accepted profile required' using errcode = '22023';
  end if;

  if not p_enabled and target_role = 'admin' and (
    select count(*)
    from public.profiles as profile
    where profile.role = 'admin'
      and profile.status = 'accepted'
      and profile.deleted_at is null
  ) = 1 then
    raise exception 'the final app administrator cannot be demoted'
      using errcode = '55000';
  end if;

  update public.profiles
  set role = case
    when p_enabled then 'admin'::public.app_role
    else 'member'::public.app_role
  end
  where id = p_profile_id;

  return query select p_profile_id, p_enabled;
end;
$$;

ALTER FUNCTION "public"."admin_set_app_admin"("p_profile_id" bigint, "p_enabled" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_set_gongang_manager"("p_profile_id" bigint, "p_enabled" boolean) RETURNS TABLE("profile_id" bigint, "has_gongang_manage" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform private.require_app_admin();

  if p_enabled is null then
    raise exception 'enabled must not be null' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles as profile
    where profile.id = p_profile_id
      and profile.status = 'accepted'
      and profile.deleted_at is null
  ) then
    raise exception 'accepted profile required' using errcode = '22023';
  end if;

  if p_enabled then
    insert into public.profile_permissions (profile_id, permission_key)
    values (p_profile_id, 'gongang.manage')
    on conflict do nothing;
  else
    delete from public.profile_permissions
    where profile_permissions.profile_id = p_profile_id
      and profile_permissions.permission_key = 'gongang.manage';
  end if;

  return query select p_profile_id, p_enabled;
end;
$$;

ALTER FUNCTION "public"."admin_set_gongang_manager"("p_profile_id" bigint, "p_enabled" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_unblock_application"("p_profile_id" bigint) RETURNS TABLE("profile_id" bigint, "status" "public"."profile_status", "status_updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_profile_id bigint := private.require_app_admin();
begin
  return query
  update public.profiles as profile
  set
    status = 'draft',
    status_updated_at = now(),
    status_updated_by = caller_profile_id
  where profile.id = p_profile_id
    and profile.status = 'blocked'
    and profile.deleted_at is null
  returning profile.id, profile.status, profile.status_updated_at;

  if not found then
    raise exception 'blocked application not found' using errcode = '55000';
  end if;
end;
$$;

ALTER FUNCTION "public"."admin_unblock_application"("p_profile_id" bigint) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_suspend_profile"("p_profile_id" bigint, "p_reason" "text", "p_duration_days" integer) RETURNS TABLE("suspension_id" bigint, "expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_profile_id bigint := private.require_app_admin();
  trimmed_reason text := btrim(coalesce(p_reason, ''));
  target_role public.app_role;
  suspension_expires_at timestamp with time zone;
  created_suspension_id bigint;
begin
  perform private.require_recent_password_auth();

  select profile.role
  into target_role
  from public.profiles as profile
  where profile.id = p_profile_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
  for update;

  if target_role is null then
    raise exception 'accepted profile required' using errcode = '22023';
  end if;
  -- 관리자끼리 서로 잠그는 사고를 막는다. 관리자를 정지하려면 먼저 강등한다.
  if target_role = 'admin' then
    raise exception 'app administrators cannot be suspended' using errcode = '22023';
  end if;
  if char_length(trimmed_reason) not between 5 and 300 then
    raise exception 'reason must be 5 to 300 characters' using errcode = '22023';
  end if;
  if p_duration_days is not null and p_duration_days not between 1 and 180 then
    raise exception 'days must be between 1 and 180' using errcode = '22023';
  end if;

  update private.profile_suspensions as suspension
  set ended_at = suspension.expires_at
  where suspension.profile_id = p_profile_id
    and suspension.ended_at is null
    and suspension.expires_at <= now();
  if private.profile_suspended(p_profile_id) then
    raise exception 'profile is already suspended' using errcode = '55000';
  end if;

  suspension_expires_at := now() + make_interval(days => p_duration_days);
  insert into private.profile_suspensions (profile_id, reason, expires_at, suspended_by_profile_id)
  values (p_profile_id, trimmed_reason, suspension_expires_at, caller_profile_id)
  returning id into created_suspension_id;
  perform private.enqueue_suspension_email(created_suspension_id, 'suspended');

  return query select created_suspension_id, suspension_expires_at;
end;
$$;

ALTER FUNCTION "public"."admin_suspend_profile"("p_profile_id" bigint, "p_reason" "text", "p_duration_days" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_lift_suspension"("p_profile_id" bigint) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_profile_id bigint := private.require_app_admin();
  lifted_suspension_id bigint;
begin
  perform private.require_recent_password_auth();

  perform 1 from public.profiles as profile where profile.id = p_profile_id for update;

  update private.profile_suspensions as suspension
  set ended_at = now(), cancelled_at = now(), cancelled_by_profile_id = caller_profile_id
  where suspension.profile_id = p_profile_id
    and suspension.ended_at is null
    and (suspension.expires_at is null or suspension.expires_at > now())
  returning suspension.id into lifted_suspension_id;

  if lifted_suspension_id is null then
    raise exception 'profile is not suspended' using errcode = '55000';
  end if;
  perform private.enqueue_suspension_email(lifted_suspension_id, 'lifted');

  return lifted_suspension_id;
end;
$$;

ALTER FUNCTION "public"."admin_lift_suspension"("p_profile_id" bigint) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "private"."require_app_admin"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."require_recent_password_auth"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."admin_list_accepted_users"("p_query" "text", "p_limit" integer, "p_offset" integer, "p_managers_only" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_accepted_users"("p_query" "text", "p_limit" integer, "p_offset" integer, "p_managers_only" boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_list_applications"("p_status" "public"."profile_status", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_applications"("p_status" "public"."profile_status", "p_limit" integer, "p_offset" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_list_members"("p_query" "text", "p_limit" integer, "p_offset" integer, "p_admins_only" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_members"("p_query" "text", "p_limit" integer, "p_offset" integer, "p_admins_only" boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_list_roster"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_roster"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_review_applications"("p_profile_ids" bigint[], "p_status" "public"."profile_status") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_review_applications"("p_profile_ids" bigint[], "p_status" "public"."profile_status") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_set_app_admin"("p_profile_id" bigint, "p_enabled" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_app_admin"("p_profile_id" bigint, "p_enabled" boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_set_gongang_manager"("p_profile_id" bigint, "p_enabled" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_gongang_manager"("p_profile_id" bigint, "p_enabled" boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_unblock_application"("p_profile_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_unblock_application"("p_profile_id" bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_suspend_profile"("p_profile_id" bigint, "p_reason" "text", "p_duration_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_suspend_profile"("p_profile_id" bigint, "p_reason" "text", "p_duration_days" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_lift_suspension"("p_profile_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_lift_suspension"("p_profile_id" bigint) TO "authenticated";

-- 앱 밖 사람도 관리자에게 닿을 수 있도록 로그인 전 화면에 공개하는 연락처. 순서(position)를 키로 써 최대 10개를 제약만으로 지킨다.
CREATE TABLE IF NOT EXISTS "public"."admin_contacts" (
    "position" smallint NOT NULL,
    "kind" "text" NOT NULL,
    "label" "text" NOT NULL,
    "value" "text" NOT NULL,
    CONSTRAINT "admin_contacts_position_check" CHECK ((("position" >= 0) AND ("position" <= 9))),
    CONSTRAINT "admin_contacts_kind_check" CHECK (("kind" = ANY (ARRAY['link'::"text", 'email'::"text"]))),
    CONSTRAINT "admin_contacts_label_check" CHECK ((("label" = "btrim"("label")) AND (("char_length"("label") >= 1) AND ("char_length"("label") <= 40)))),
    CONSTRAINT "admin_contacts_value_check" CHECK (
CASE "kind"
    WHEN 'link'::"text" THEN (("char_length"("value") <= 500) AND ("value" ~ '^https://[^[:space:]]+$'::"text"))
    WHEN 'email'::"text" THEN (("char_length"("value") <= 254) AND ("value" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'::"text"))
    ELSE false
END)
);

ALTER TABLE "public"."admin_contacts" OWNER TO "postgres";

ALTER TABLE ONLY "public"."admin_contacts"
    ADD CONSTRAINT "admin_contacts_pkey" PRIMARY KEY ("position");

ALTER TABLE "public"."admin_contacts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_contacts_select_public" ON "public"."admin_contacts" FOR SELECT TO "anon", "authenticated" USING (true);

CREATE OR REPLACE FUNCTION "public"."admin_replace_contacts"("p_contacts" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform private.require_app_admin();

  if p_contacts is null or jsonb_typeof(p_contacts) <> 'array' then
    raise exception 'contacts must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_contacts) > 10 then
    raise exception 'too many contacts' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('admin-contacts-replace', 0));

  delete from public.admin_contacts where true;

  insert into public.admin_contacts (position, kind, label, value)
  select
    (item.ordinality - 1)::smallint,
    item.contact ->> 'kind',
    btrim(item.contact ->> 'label'),
    btrim(item.contact ->> 'value')
  from jsonb_array_elements(p_contacts) with ordinality as item(contact, ordinality);
end;
$$;

ALTER FUNCTION "public"."admin_replace_contacts"("p_contacts" "jsonb") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."admin_replace_contacts"("p_contacts" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_replace_contacts"("p_contacts" "jsonb") TO "authenticated";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."admin_contacts" TO "service_role";
GRANT SELECT ON TABLE "public"."admin_contacts" TO "anon";
GRANT SELECT ON TABLE "public"."admin_contacts" TO "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."admin_contacts" FROM "anon", "authenticated";
