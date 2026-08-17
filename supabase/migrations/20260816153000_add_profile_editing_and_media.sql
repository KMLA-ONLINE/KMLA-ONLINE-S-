alter table public.profiles
add column cover_path text,
add column contact_email text,
add column department text;

alter table public.profiles
add constraint profiles_contact_email_format check (
  contact_email is null
  or contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
),
add constraint profiles_department_length check (
  department is null
  or char_length(btrim(department)) between 1 and 100
);

alter table public.profiles drop constraint profiles_type_details;
alter table public.profiles
add constraint profiles_type_details check (
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
    and dorm_room is null
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-media',
  'profile-media',
  false,
  4194304,
  array['image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function private.is_own_profile_media_path(p_object_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    where profile.auth_user_id = auth.uid()
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and (
        p_object_path like profile.id::text || '/avatar/%'
        or p_object_path like profile.id::text || '/cover/%'
      )
  );
$$;

revoke all on function private.is_own_profile_media_path(text) from public, anon;
grant execute on function private.is_own_profile_media_path(text) to authenticated;

create function private.can_read_profile_media_path(p_object_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as viewer
    where viewer.auth_user_id = auth.uid()
      and viewer.status = 'accepted'
      and viewer.deleted_at is null
  )
  and exists (
    select 1
    from public.profiles as target
    where target.status = 'accepted'
      and target.deleted_at is null
      and p_object_path like target.id::text || '/%'
  );
$$;

revoke all on function private.can_read_profile_media_path(text) from public, anon;
grant execute on function private.can_read_profile_media_path(text) to authenticated;

create policy "profile_media_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-media'
  and owner_id = (select auth.uid()::text)
  and private.is_own_profile_media_path(name)
);

create policy "profile_media_select_accepted"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'profile-media'
  and private.can_read_profile_media_path(name)
);

create policy "profile_media_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-media'
  and owner_id = (select auth.uid()::text)
  and private.is_own_profile_media_path(name)
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
  p_allow_timeline_posts boolean default true
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
    and (p_gender is null or p_cohort is null or p_academic_track is null) then
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
    gender = case
      when current_profile.type in ('student', 'alumni') then p_gender
      else null
    end,
    cohort = current_profile.cohort,
    academic_track = case
      when current_profile.type in ('student', 'alumni') then p_academic_track
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
  boolean
) to authenticated;

create function public.set_my_profile_media(
  p_slot text,
  p_object_path text
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

  if p_object_path not like current_profile.id::text || '/' || p_slot || '/%' then
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

  if p_slot = 'avatar' then
    update public.profiles
    set avatar_path = p_object_path
    where id = current_profile.id
    returning * into updated_profile;
  else
    update public.profiles
    set cover_path = p_object_path
    where id = current_profile.id
    returning * into updated_profile;
  end if;

  return updated_profile;
end;
$$;

revoke all on function public.set_my_profile_media(text, text) from public, anon;
grant execute on function public.set_my_profile_media(text, text) to authenticated;

create function public.remove_my_profile_media(p_slot text)
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

revoke all on function public.remove_my_profile_media(text) from public, anon;
grant execute on function public.remove_my_profile_media(text) to authenticated;
