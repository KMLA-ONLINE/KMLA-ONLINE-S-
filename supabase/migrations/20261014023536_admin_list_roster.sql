SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.admin_list_roster()
  RETURNS TABLE (
    profile_id   bigint,
    pub_id       text,
    name         text,
    profile_type public.profile_type,
    cohort       smallint,
    department   text,
    is_app_admin boolean,
    approved_at  timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_app_admin();

  -- 화면이 기수·유형별 인원 수를 세고 필터·정렬·CSV를 브라우저에서 하므로 승인된 사용자 전체를 한 번에 돌려준다.
  return query
  select
    profile.id, profile.pub_id, profile.name, profile.type, profile.cohort,
    profile.department, profile.role = 'admin', profile.status_updated_at
  from public.profiles as profile
  where profile.status = 'accepted'
    and profile.deleted_at is null
  order by profile.name, profile.id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."admin_list_roster"() FROM PUBLIC, "anon", "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_list_roster"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_list_roster"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_list_roster"() TO "postgres";
