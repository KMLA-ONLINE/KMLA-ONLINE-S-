alter table public.profiles
add column if not exists is_returning_student boolean not null default false;
