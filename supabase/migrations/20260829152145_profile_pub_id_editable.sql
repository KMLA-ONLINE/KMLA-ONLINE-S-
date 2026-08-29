-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION
  public.update_my_profile(p_name text, p_description text, p_birthday date, p_phone_number text, p_contact_email text, p_gender public.profile_gender, p_cohort smallint,
  p_academic_track public.profile_academic_track, p_department text, p_class_no smallint, p_dorm_room smallint, p_allow_timeline_posts boolean, p_is_returning_student boolean);

CREATE FUNCTION public.update_my_profile (
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
$function$;

REVOKE ALL ON FUNCTION
  public.update_my_profile(text, text, date, text, text, public.profile_gender, smallint, public.profile_academic_track, text, smallint, smallint, boolean, boolean, text) FROM
  PUBLIC;

GRANT ALL ON FUNCTION
  public.update_my_profile(text, text, date, text, text, public.profile_gender, smallint, public.profile_academic_track, text, smallint, smallint, boolean, boolean, text) TO
  authenticated;