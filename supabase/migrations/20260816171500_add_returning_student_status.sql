alter table public.profiles
add column is_returning_student boolean not null default false;

drop function if exists public.update_my_profile(
  text,
  text,
  date,
  text,
  text,
  public.profile_gender,
  smallint,
  public.profile_academic_track,
  text,
  smallint,
  smallint,
  boolean
);

create function public.update_my_profile(
  p_name text,
  p_description text default null,
  p_birthday date default null,
  p_phone_number text default null,
  p_contact_email text default null,
  p_gender public.profile_gender default null,
  p_cohort smallint default null,
  p_academic_track public.profile_academic_track default null,
  p_department text default null,
  p_class_no smallint default null,
  p_dorm_room smallint default null,
  p_allow_timeline_posts boolean default true,
  p_is_returning_student boolean default false
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.update_my_profile(
  text,
  text,
  date,
  text,
  text,
  public.profile_gender,
  smallint,
  public.profile_academic_track,
  text,
  smallint,
  smallint,
  boolean,
  boolean
) from public, anon;

grant execute on function public.update_my_profile(
  text,
  text,
  date,
  text,
  text,
  public.profile_gender,
  smallint,
  public.profile_academic_track,
  text,
  smallint,
  smallint,
  boolean,
  boolean
) to authenticated;
