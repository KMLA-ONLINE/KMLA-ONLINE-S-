-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.list_birthdays (
  p_reference_date date,
  p_scope          text DEFAULT 'month'::text
)
  RETURNS TABLE (
    pub_id         text,
    name           text,
    avatar_path    text,
    birthday_month smallint,
    birthday_day   smallint,
    birthday_date  date
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.list_birthdays(date, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.list_birthdays(date, text) TO authenticated;
