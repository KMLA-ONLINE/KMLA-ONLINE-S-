alter type public.profile_status rename value 'rejected' to 'blocked';
alter type public.profile_status add value 'draft' before 'pending';

alter table public.profiles drop column rejection_reason;

create function private.require_app_admin()
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  caller_profile_id bigint;
begin
  select profile.id
  into caller_profile_id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.role = 'admin'
    and profile.deleted_at is null;

  if caller_profile_id is null then
    raise exception 'app administrator required' using errcode = '42501';
  end if;

  return caller_profile_id;
end;
$$;

revoke all on function private.require_app_admin() from public, anon, authenticated;

create function private.require_recent_password_auth()
returns void
language plpgsql
stable
set search_path = ''
as $$
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

revoke all on function private.require_recent_password_auth()
from public, anon, authenticated;

create or replace function public.submit_my_profile(
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

revoke all on function public.submit_my_profile(
  text, public.profile_type, text, smallint, smallint, public.profile_gender,
  public.profile_academic_track, text, date, smallint
) from public, anon;
grant execute on function public.submit_my_profile(
  text, public.profile_type, text, smallint, smallint, public.profile_gender,
  public.profile_academic_track, text, date, smallint
) to authenticated;

create function public.admin_list_applications(
  p_status public.profile_status,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  profile_id bigint,
  pub_id text,
  name text,
  profile_type public.profile_type,
  is_returning_student boolean,
  submitted_at timestamptz,
  status_updated_at timestamptz,
  cohort smallint,
  class_no smallint,
  academic_track public.profile_academic_track,
  department text,
  student_number text,
  gender public.profile_gender,
  birthday date,
  phone_number text,
  dorm_room smallint,
  description text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    profile.id, profile.pub_id, profile.name, profile.type,
    profile.is_returning_student, profile.submitted_at,
    profile.status_updated_at, profile.cohort, profile.class_no,
    profile.academic_track, profile.department, profile.student_number,
    profile.gender, profile.birthday, profile.phone_number,
    profile.dorm_room, profile.description, count(*) over ()
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

create function public.admin_review_applications(
  p_profile_ids bigint[],
  p_status public.profile_status
)
returns table (profile_id bigint, status public.profile_status, status_updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
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

create function public.admin_unblock_application(p_profile_id bigint)
returns table (profile_id bigint, status public.profile_status, status_updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
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

create function public.admin_list_accepted_users(
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_managers_only boolean default false
)
returns table (
  profile_id bigint,
  pub_id text,
  name text,
  profile_type public.profile_type,
  cohort smallint,
  department text,
  has_gongang_manage boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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

create function public.admin_set_gongang_manager(
  p_profile_id bigint,
  p_enabled boolean
)
returns table (profile_id bigint, has_gongang_manage boolean)
language plpgsql
security definer
set search_path = ''
as $$
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

create function public.admin_list_members(
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_admins_only boolean default false
)
returns table (
  profile_id bigint,
  pub_id text,
  name text,
  profile_type public.profile_type,
  cohort smallint,
  department text,
  is_app_admin boolean,
  is_self boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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

create function public.admin_set_app_admin(
  p_profile_id bigint,
  p_enabled boolean
)
returns table (profile_id bigint, is_app_admin boolean)
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.admin_list_applications(public.profile_status, integer, integer) from public, anon;
revoke all on function public.admin_review_applications(bigint[], public.profile_status) from public, anon;
revoke all on function public.admin_unblock_application(bigint) from public, anon;
revoke all on function public.admin_list_accepted_users(text, integer, integer, boolean) from public, anon;
revoke all on function public.admin_set_gongang_manager(bigint, boolean) from public, anon;
revoke all on function public.admin_list_members(text, integer, integer, boolean) from public, anon;
revoke all on function public.admin_set_app_admin(bigint, boolean) from public, anon;

grant execute on function public.admin_list_applications(public.profile_status, integer, integer) to authenticated;
grant execute on function public.admin_review_applications(bigint[], public.profile_status) to authenticated;
grant execute on function public.admin_unblock_application(bigint) to authenticated;
grant execute on function public.admin_list_accepted_users(text, integer, integer, boolean) to authenticated;
grant execute on function public.admin_set_gongang_manager(bigint, boolean) to authenticated;
grant execute on function public.admin_list_members(text, integer, integer, boolean) to authenticated;
grant execute on function public.admin_set_app_admin(bigint, boolean) to authenticated;
