create table public.permissions (
  key text primary key,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table public.profile_permissions (
  profile_id bigint not null
    references public.profiles(id)
    on delete cascade,

  permission_key text not null
    references public.permissions(key)
    on delete cascade,

  created_at timestamptz not null default now(),

  primary key (
    profile_id,
    permission_key
  )
);

create table public.gongang_schedule (
  schedule_date date not null,
  slot text not null,
  location text not null,
  enabled boolean not null default true,

  configured_by bigint
    references public.profiles(id)
    on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (
    schedule_date,
    slot,
    location
  ),

  constraint gongang_schedule_location_check
    check (
      location in (
        'floor_b1',
        'floor_2',
        'floor_4',
        'floor_10'
      )
    ),

  constraint gongang_schedule_slot_check
    check (
      slot in (
        'study-1',
        'honjeong-end',
        'study-2',
        'hour-8',
        'hour-9',
        'hour-10',
        'hour-11',
        'hour-12',
        'hour-13',
        'hour-14',
        'hour-15',
        'hour-16',
        'hour-17',
        'hour-18'
      )
    )
);

insert into public.permissions (
  key,
  name,
  description
)
values (
  'gongang.manage',
  '공강 관리자',
  '다음 주 공강 운영 일정을 설정할 수 있습니다.'
);


alter table public.permissions
enable row level security;

alter table public.profile_permissions
enable row level security;

alter table public.gongang_schedule
enable row level security;


create policy "permissions_select"
on public.permissions
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles as profile
    where profile.auth_user_id = (select auth.uid())
      and profile.status = 'accepted'
      and profile.deleted_at is null
  )
);


create policy "profile_permissions_select_own"
on public.profile_permissions
for select
to authenticated
using (
  profile_id = (
    select profile.id
    from public.profiles as profile
    where profile.auth_user_id = (select auth.uid())
      and profile.status = 'accepted'
      and profile.deleted_at is null
  )
);


create policy "gongang_schedule_select"
on public.gongang_schedule
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles as profile
    where profile.auth_user_id = (select auth.uid())
      and profile.status = 'accepted'
      and profile.deleted_at is null
  )
);


create policy "gongang_schedule_insert_manager"
on public.gongang_schedule
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles as profile
    join public.profile_permissions as permission
      on permission.profile_id = profile.id
    where profile.auth_user_id = (select auth.uid())
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and permission.permission_key = 'gongang.manage'
  )
);


create policy "gongang_schedule_update_manager"
on public.gongang_schedule
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles as profile
    join public.profile_permissions as permission
      on permission.profile_id = profile.id
    where profile.auth_user_id = (select auth.uid())
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and permission.permission_key = 'gongang.manage'
  )
)
with check (
  exists (
    select 1
    from public.profiles as profile
    join public.profile_permissions as permission
      on permission.profile_id = profile.id
    where profile.auth_user_id = (select auth.uid())
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and permission.permission_key = 'gongang.manage'
  )
);


create policy "gongang_schedule_delete_manager"
on public.gongang_schedule
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles as profile
    join public.profile_permissions as permission
      on permission.profile_id = profile.id
    where profile.auth_user_id = (select auth.uid())
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and permission.permission_key = 'gongang.manage'
  )
);


create function private.prepare_gongang_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  caller_profile_id bigint;
  korea_today date;
  next_monday date;
  next_sunday date;
begin
  select profile.id
  into caller_profile_id
  from public.profiles as profile
  join public.profile_permissions as permission
    on permission.profile_id = profile.id
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and permission.permission_key = 'gongang.manage';

  if not found then
    raise exception 'gongang manager permission required'
      using errcode = '42501';
  end if;

  korea_today :=
    (now() at time zone 'Asia/Seoul')::date;

  next_monday :=
    korea_today
    + (
      8
      - extract(isodow from korea_today)::integer
    );

  next_sunday := next_monday + 6;

  if new.schedule_date < next_monday
    or new.schedule_date > next_sunday
  then
    raise exception 'only next week can be configured'
      using errcode = '22023';
  end if;

  new.configured_by := caller_profile_id;
  new.updated_at := now();

  return new;
end;
$$;


create trigger gongang_schedule_prepare
before insert or update
on public.gongang_schedule
for each row
execute function private.prepare_gongang_schedule();


revoke all
on table public.permissions
from anon, authenticated;

revoke all
on table public.profile_permissions
from anon, authenticated;

revoke all
on table public.gongang_schedule
from anon, authenticated;


grant select
on table public.permissions
to authenticated;

grant select
on table public.profile_permissions
to authenticated;

grant
  select,
  insert,
  update,
  delete
on table public.gongang_schedule
to authenticated;
