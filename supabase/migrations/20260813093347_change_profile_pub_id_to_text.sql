create function private.generate_profile_pub_id()
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  candidate text;
begin
  perform pg_catalog.pg_advisory_xact_lock(783094812);

  loop
    candidate := encode(extensions.gen_random_bytes(6), 'hex');
    exit when not exists (
      select 1
      from public.profiles as profile
      where lower(profile.pub_id::text) = candidate
    );
  end loop;

  return candidate;
end;
$$;

revoke all on function private.generate_profile_pub_id() from public, anon, authenticated;

-- PostgreSQL will not alter pub_id while functions depend on it. Preserve the
-- latest replayed definitions so this migration stays aligned with earlier API changes.
create temporary table profile_pub_id_function_defs (definition text not null);

insert into profile_pub_id_function_defs (definition)
select replace(pg_get_functiondef(function_oid), 'pub_id uuid', 'pub_id text')
from unnest(array[
  'public.list_group_posts(uuid,uuid,timestamp with time zone,uuid,integer)'::regprocedure,
  'public.get_group_post(uuid)'::regprocedure,
  'public.search_group_posts(uuid,text,integer)'::regprocedure,
  'public.list_group_members(uuid,text)'::regprocedure,
  'public.list_group_join_requests(uuid)'::regprocedure
]) as function_oid;

drop function public.list_group_posts(uuid, uuid, timestamptz, uuid, integer);
drop function public.get_group_post(uuid);
drop function public.search_group_posts(uuid, text, integer);
drop function public.list_group_members(uuid, text);
drop function public.list_group_join_requests(uuid);

alter table public.profiles drop constraint profiles_pub_id_key;
alter table public.profiles alter column pub_id drop default;
alter table public.profiles
alter column pub_id type text using private.generate_profile_pub_id();
alter table public.profiles
alter column pub_id set default private.generate_profile_pub_id();

alter table public.profiles
add constraint profiles_pub_id_format check (
  pub_id ~ '^[a-z0-9](?:[a-z0-9-]{3,13}[a-z0-9])$'
);

create unique index profiles_pub_id_case_insensitive_key
on public.profiles (lower(pub_id));

do $$
declare
  function_definition text;
begin
  for function_definition in
    select definition from profile_pub_id_function_defs
  loop
    execute function_definition;
  end loop;
end;
$$;

revoke all on function public.list_group_posts(uuid, uuid, timestamptz, uuid, integer) from public, anon;
revoke all on function public.get_group_post(uuid) from public, anon;
revoke all on function public.search_group_posts(uuid, text, integer) from public, anon;
revoke all on function public.list_group_members(uuid, text) from public, anon;
revoke all on function public.list_group_join_requests(uuid) from public, anon;

grant execute on function public.list_group_posts(uuid, uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.get_group_post(uuid) to authenticated;
grant execute on function public.search_group_posts(uuid, text, integer) to authenticated;
grant execute on function public.list_group_members(uuid, text) to authenticated;
grant execute on function public.list_group_join_requests(uuid) to authenticated;

create policy "profiles_select_accepted"
on public.profiles
for select
to authenticated
using (status = 'accepted' and deleted_at is null);
