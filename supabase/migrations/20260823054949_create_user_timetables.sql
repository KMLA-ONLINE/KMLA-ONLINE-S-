create table public.user_timetables (
  profile_id bigint primary key
    references public.profiles(id)
    on delete cascade,

  active_semester text not null default '1-1',

  semesters jsonb not null default
    '{
      "1-1": [],
      "1-2": [],
      "2-1": [],
      "2-2": [],
      "3-1": [],
      "3-2": []
    }'::jsonb,

  updated_at timestamptz not null default now(),

  constraint user_timetables_semester_check
    check (
      active_semester in (
        '1-1', '1-2',
        '2-1', '2-2',
        '3-1', '3-2'
      )
    ),

  constraint user_timetables_json_check
    check (
      jsonb_typeof(semesters) = 'object'
      and jsonb_typeof(semesters -> '1-1') = 'array'
      and jsonb_typeof(semesters -> '1-2') = 'array'
      and jsonb_typeof(semesters -> '2-1') = 'array'
      and jsonb_typeof(semesters -> '2-2') = 'array'
      and jsonb_typeof(semesters -> '3-1') = 'array'
      and jsonb_typeof(semesters -> '3-2') = 'array'
    )
);

alter table public.user_timetables
enable row level security;


create policy "user_timetables_select_own"
on public.user_timetables
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


create policy "user_timetables_insert_own"
on public.user_timetables
for insert
to authenticated
with check (
  profile_id = (
    select profile.id
    from public.profiles as profile
    where profile.auth_user_id = (select auth.uid())
      and profile.status = 'accepted'
      and profile.deleted_at is null
  )
);


create policy "user_timetables_update_own"
on public.user_timetables
for update
to authenticated
using (
  profile_id = (
    select profile.id
    from public.profiles as profile
    where profile.auth_user_id = (select auth.uid())
      and profile.status = 'accepted'
      and profile.deleted_at is null
  )
)
with check (
  profile_id = (
    select profile.id
    from public.profiles as profile
    where profile.auth_user_id = (select auth.uid())
      and profile.status = 'accepted'
      and profile.deleted_at is null
  )
);


revoke all
on table public.user_timetables
from anon, authenticated;

grant select, insert, update
on table public.user_timetables
to authenticated;
