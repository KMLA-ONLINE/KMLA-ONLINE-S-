create table if not exists public.profile_departments (
  name text primary key,
  sort_order smallint not null,
  is_active boolean not null default true,
  constraint profile_departments_name_length
    check (char_length(btrim(name)) between 1 and 100),
  constraint profile_departments_sort_order_range
    check (sort_order >= 0)
);

insert into public.profile_departments (name, sort_order)
values
  ('과학기술부', 10),
  ('금융정보부', 20),
  ('도서부', 30),
  ('동아리관리부', 40),
  ('문화기획부', 50),
  ('방송부', 60),
  ('법무부', 70),
  ('식품영양부', 80),
  ('영어상용부', 90),
  ('체육부', 100),
  ('학습부', 110),
  ('환경부', 120)
on conflict (name) do update
set
  sort_order = excluded.sort_order,
  is_active = true;

alter table public.profile_departments
enable row level security;

drop policy if exists "profile_departments_select_active"
on public.profile_departments;

create policy "profile_departments_select_active"
on public.profile_departments
for select
to authenticated
using (is_active);

revoke all
on table public.profile_departments
from anon, authenticated;

grant select
on table public.profile_departments
to authenticated;


alter table public.profiles
drop constraint if exists profiles_class_no_range;

alter table public.profiles
add constraint profiles_class_no_range
check (
  class_no is null
  or class_no between 1 and 10
);


alter table public.profiles
drop constraint if exists profiles_dorm_room_range;

alter table public.profiles
add constraint profiles_dorm_room_range
check (
  dorm_room is null
  or dorm_room between 1 and 1004
);
