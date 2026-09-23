create type public.app_role as enum ('member', 'admin');
create type public.profile_type as enum ('student', 'alumni', 'teacher');
create type public.profile_gender as enum ('male', 'female');
create type public.profile_status as enum (
  'pending',
  'accepted',
  'rejected',
  'withdrawn'
);
create type public.profile_academic_track as enum ('domestic', 'international');

create schema if not exists private;
revoke all on schema private from public;

create table public.profiles (
  id bigint generated always as identity primary key,
  auth_user_id uuid unique references auth.users (id) on delete set null,
  pub_id uuid not null default gen_random_uuid() unique,
  name text not null,
  anonymous_username text,
  role public.app_role not null default 'member',
  type public.profile_type not null,
  student_number text unique,
  class_no smallint,
  cohort smallint,
  gender public.profile_gender,
  academic_track public.profile_academic_track,
  phone_number text,
  avatar_path text,
  birthday date,
  description text,
  status public.profile_status not null default 'pending',
  dorm_room smallint,
  onboarding_completed_at timestamptz not null default now(),
  submitted_at timestamptz not null default now(),
  rejection_reason text,
  status_updated_at timestamptz not null default now(),
  status_updated_by bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint profiles_status_updated_by_fkey
    foreign key (status_updated_by) references public.profiles (id) on delete set null,
  constraint profiles_name_length check (char_length(btrim(name)) between 1 and 50),
  constraint profiles_anonymous_username_length check (
    anonymous_username is null
    or char_length(anonymous_username) between 1 and 50
  ),
  constraint profiles_student_number_format check (
    student_number is null or student_number ~ '^[0-9]{6}$'
  ),
  constraint profiles_class_no_range check (class_no is null or class_no between 1 and 20),
  constraint profiles_cohort_range check (cohort is null or cohort between 1 and 100),
  constraint profiles_dorm_room_range check (dorm_room is null or dorm_room between 1 and 999),
  constraint profiles_phone_number_format check (
    phone_number is null or phone_number ~ '^\+?[0-9 -]{8,20}$'
  ),
  constraint profiles_description_length check (
    description is null or char_length(description) <= 2000
  ),
  constraint profiles_type_details check (
    (
      type = 'student'
      and student_number is not null
      and birthday is not null
      and cohort is not null
      and gender is not null
      and academic_track is not null
    )
    or (
      type = 'alumni'
      and cohort is not null
      and gender is not null
      and academic_track is not null
      and class_no is null
      and dorm_room is null
    )
    or (
      type = 'teacher'
      and student_number is null
      and class_no is null
      and cohort is null
      and gender is null
      and academic_track is null
      and birthday is null
      and dorm_room is null
    )
  )
);

create index profiles_status_idx on public.profiles (status)
where deleted_at is null;
create index profiles_status_updated_by_idx on public.profiles (status_updated_by)
where status_updated_by is not null;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (
  (select auth.uid()) = auth_user_id
  and deleted_at is null
);

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;

create function public.get_my_profile()
returns setof public.profiles
language sql
stable
security invoker
set search_path = ''
as $$
  select profile.*
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.deleted_at is null;
$$;

revoke all on function public.get_my_profile() from public;
grant execute on function public.get_my_profile() to authenticated;

-- This is intentionally SECURITY DEFINER: clients have no INSERT/UPDATE table
-- grants, and this function is the only allowed onboarding state transition.
create function public.submit_my_profile(
  p_name text,
  p_type public.profile_type,
  p_student_number text default null,
  p_class_no smallint default null,
  p_cohort smallint default null,
  p_gender public.profile_gender default null,
  p_academic_track public.profile_academic_track default null,
  p_phone_number text default null,
  p_birthday date default null,
  p_dorm_room smallint default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
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

  if found and existing_profile.status <> 'rejected' then
    raise exception 'profile cannot be submitted in its current state'
      using errcode = '55000';
  end if;

  if existing_profile.id is null then
    insert into public.profiles (
      auth_user_id,
      name,
      type,
      student_number,
      class_no,
      cohort,
      gender,
      academic_track,
      phone_number,
      birthday,
      dorm_room
    )
    values (
      caller_id,
      btrim(p_name),
      p_type,
      nullif(btrim(p_student_number), ''),
      p_class_no,
      p_cohort,
      p_gender,
      p_academic_track,
      nullif(btrim(p_phone_number), ''),
      p_birthday,
      p_dorm_room
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
      rejection_reason = null,
      status_updated_at = now(),
      status_updated_by = null,
      deleted_at = null
    where id = existing_profile.id
    returning * into submitted_profile;
  end if;

  return submitted_profile;
end;
$$;

revoke all on function public.submit_my_profile(
  text,
  public.profile_type,
  text,
  smallint,
  smallint,
  public.profile_gender,
  public.profile_academic_track,
  text,
  date,
  smallint
) from public;
grant execute on function public.submit_my_profile(
  text,
  public.profile_type,
  text,
  smallint,
  smallint,
  public.profile_gender,
  public.profile_academic_track,
  text,
  date,
  smallint
) to authenticated;
