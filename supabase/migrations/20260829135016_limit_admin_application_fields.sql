-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.admin_list_applications(IN p_status public.profile_status, IN p_limit integer, IN p_offset integer);

CREATE FUNCTION public.admin_list_applications (
  p_status public.profile_status,
  p_limit  integer               DEFAULT 50,
  p_offset integer               DEFAULT 0
)
  RETURNS TABLE (
    profile_id           bigint,
    name                 text,
    profile_type         public.profile_type,
    is_returning_student boolean,
    submitted_at         timestamp with time zone,
    cohort               smallint,
    student_number       text,
    gender               public.profile_gender,
    birthday             date,
    total_count          bigint
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.admin_list_applications(public.profile_status, integer, integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.admin_list_applications(public.profile_status, integer, integer) TO authenticated;