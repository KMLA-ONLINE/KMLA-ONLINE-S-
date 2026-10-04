create type public.group_kind as enum ('official', 'unofficial');
create type public.group_join_policy as enum ('open', 'request', 'invite_only');
create type public.group_identity_policy as enum (
  'identified',
  'optional_anonymous',
  'always_anonymous'
);
create type public.group_posting_policy as enum ('members', 'staff');
create type public.group_member_role as enum ('owner', 'admin', 'manager', 'member');

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  slug_is_custom boolean not null default false,
  kind public.group_kind not null,
  name text not null,
  search_name text generated always as (
    lower(regexp_replace(btrim(name), '[[:space:]]+', '', 'g'))
  ) stored,
  description text not null default '',
  join_policy public.group_join_policy not null,
  identity_policy public.group_identity_policy not null,
  posting_policy public.group_posting_policy not null,
  created_by bigint not null references public.profiles (id),
  icon_path text,
  cover_path text,
  member_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint groups_name_length check (char_length(btrim(name)) between 1 and 50),
  constraint groups_description_length check (char_length(description) <= 2000),
  constraint groups_slug_format check (
    char_length(slug) between 3 and 50
    and slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'
  ),
  constraint groups_slug_reserved check (slug not in ('create', 'discover')),
  constraint groups_member_count_nonnegative check (member_count >= 0),
  constraint groups_invite_slug_generated check (
    join_policy <> 'invite_only'
    or (
      slug_is_custom = false
      and slug ~ '^g-[a-f0-9]{20}$'
    )
  )
);

create unique index groups_official_name_unique_idx
on public.groups (lower(btrim(name)))
where kind = 'official';

create index groups_discovery_idx
on public.groups (kind, join_policy, member_count desc, id);

create index groups_created_by_idx on public.groups (created_by);

create table public.group_memberships (
  group_id uuid not null references public.groups (id) on delete cascade,
  profile_id bigint not null references public.profiles (id) on delete cascade,
  role public.group_member_role not null default 'member',
  joined_at timestamptz not null default now(),
  pinned_at timestamptz,
  primary key (group_id, profile_id)
);

create unique index group_memberships_one_owner_idx
on public.group_memberships (group_id)
where role = 'owner';

create index group_memberships_profile_order_idx
on public.group_memberships (profile_id, pinned_at desc, joined_at desc);

create table public.group_join_requests (
  group_id uuid not null references public.groups (id) on delete cascade,
  profile_id bigint not null references public.profiles (id) on delete cascade,
  requested_at timestamptz not null default now(),
  primary key (group_id, profile_id)
);

create index group_join_requests_profile_idx
on public.group_join_requests (profile_id, requested_at desc);

create index profiles_accepted_students_idx
on public.profiles (id)
where status = 'accepted'
  and type = 'student'
  and deleted_at is null;

create trigger groups_set_updated_at
before update on public.groups
for each row execute function private.set_updated_at();

create function private.prevent_group_identity_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
    or new.slug <> old.slug
    or new.slug_is_custom <> old.slug_is_custom
    or new.kind <> old.kind then
    raise exception 'group identity cannot be changed' using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_group_identity_changes() from public;

create trigger groups_prevent_identity_changes
before update on public.groups
for each row execute function private.prevent_group_identity_changes();

create function private.current_profile_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null;
$$;

grant usage on schema private to authenticated;
revoke all on function private.current_profile_id() from public;
grant execute on function private.current_profile_id() to authenticated;

create function private.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = p_group_id
      and membership.profile_id = private.current_profile_id()
  );
$$;

revoke all on function private.is_group_member(uuid) from public;
grant execute on function private.is_group_member(uuid) to authenticated;

-- Membership rows are hidden for anonymous rosters, so the public count lives
-- on the group row. This trigger keeps it transactionally consistent.
create function private.sync_group_member_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.groups
    set member_count = member_count + 1
    where id = new.group_id;
  elsif tg_op = 'DELETE' then
    update public.groups
    set member_count = greatest(member_count - 1, 0)
    where id = old.group_id;
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function private.sync_group_member_count() from public;

create trigger group_memberships_sync_count
after insert or delete on public.group_memberships
for each row execute function private.sync_group_member_count();

create function private.recount_group_members(p_group_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.groups as group_record
  set member_count = (
    select count(*)::bigint
    from public.group_memberships as membership
    where membership.group_id = p_group_id
  )
  where group_record.id = p_group_id;
$$;

revoke all on function private.recount_group_members(uuid) from public;

-- Group creation and profile acceptance share this lock so neither transaction
-- can miss an official membership created by the other.
create function private.initialize_group_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  creator public.profiles;
begin
  select profile.*
  into creator
  from public.profiles as profile
  where profile.id = new.created_by
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if creator.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  if new.kind = 'official'
    and (creator.role <> 'admin' or creator.type = 'teacher') then
    raise exception 'official group creation is not allowed' using errcode = '42501';
  end if;

  if new.kind = 'official' then
    perform pg_catalog.pg_advisory_xact_lock(4815162342);

    insert into public.group_memberships (group_id, profile_id)
    select new.id, profile.id
    from public.profiles as profile
    where profile.status = 'accepted'
      and profile.type = 'student'
      and profile.deleted_at is null
    on conflict on constraint group_memberships_pkey do nothing;
  end if;

  insert into public.group_memberships (group_id, profile_id, role)
  values (new.id, creator.id, 'owner')
  on conflict on constraint group_memberships_pkey do update set role = excluded.role;

  return new;
end;
$$;

revoke all on function private.initialize_group_memberships() from public;

create trigger groups_initialize_memberships
after insert on public.groups
for each row execute function private.initialize_group_memberships();

create function private.sync_student_official_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    tg_op = 'INSERT'
    or old.status is distinct from new.status
    or old.type is distinct from new.type
    or old.deleted_at is distinct from new.deleted_at
  ) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(4815162342);

  if new.status = 'accepted'
    and new.type = 'student'
    and new.deleted_at is null then
    insert into public.group_memberships (group_id, profile_id)
    select group_record.id, new.id
    from public.groups as group_record
    where group_record.kind = 'official'
    on conflict on constraint group_memberships_pkey do nothing;
  elsif new.type = 'teacher'
    or new.status <> 'accepted'
    or new.deleted_at is not null then
    if exists (
      select 1
      from public.group_memberships as membership
      join public.groups as group_record on group_record.id = membership.group_id
      where membership.profile_id = new.id
        and membership.role = 'owner'
        and group_record.kind = 'official'
    ) then
      raise exception 'official group owner must transfer ownership before losing eligibility'
        using errcode = '23514';
    end if;

    delete from public.group_memberships as membership
    using public.groups as group_record
    where membership.group_id = group_record.id
      and membership.profile_id = new.id
      and group_record.kind = 'official';
  end if;

  return new;
end;
$$;

revoke all on function private.sync_student_official_memberships() from public;

create trigger profiles_sync_official_memberships
after insert or update of status, type, deleted_at on public.profiles
for each row execute function private.sync_student_official_memberships();

alter table public.groups enable row level security;
alter table public.group_memberships enable row level security;
alter table public.group_join_requests enable row level security;

create policy "groups_select_visible"
on public.groups
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles as profile
    where profile.auth_user_id = (select auth.uid())
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and (
        (
          profile.type in ('student', 'alumni')
          and (
            groups.kind = 'official'
            or (
              groups.kind = 'unofficial'
              and groups.join_policy <> 'invite_only'
            )
          )
        )
        or (
          groups.kind = 'unofficial'
          and private.is_group_member(groups.id)
        )
      )
  )
);

create policy "groups_insert_accepted_creator"
on public.groups
for insert
to authenticated
with check (
  -- PostgREST executes one RPC per transaction. Revisit this marker before
  -- exposing any authenticated facility that can set arbitrary SQL settings.
  current_setting('app.create_group', true) = '1'
  and
  exists (
    select 1
    from public.profiles as profile
    where profile.auth_user_id = (select auth.uid())
      and profile.id = groups.created_by
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and (
        groups.kind = 'unofficial'
        or (
          groups.kind = 'official'
          and profile.role = 'admin'
          and profile.type in ('student', 'alumni')
        )
      )
  )
);

create policy "group_memberships_select_own"
on public.group_memberships
for select
to authenticated
using (profile_id = private.current_profile_id());

create policy "group_memberships_join_open"
on public.group_memberships
for insert
to authenticated
with check (
  profile_id = private.current_profile_id()
  and role = 'member'
  and exists (
    select 1
    from public.profiles as profile
    join public.groups as group_record on group_record.id = group_memberships.group_id
    where profile.id = group_memberships.profile_id
      and profile.type in ('student', 'alumni')
      and group_record.join_policy = 'open'
  )
);

create policy "group_memberships_update_own"
on public.group_memberships
for update
to authenticated
using (profile_id = private.current_profile_id())
with check (profile_id = private.current_profile_id());

create policy "group_join_requests_select_own"
on public.group_join_requests
for select
to authenticated
using (profile_id = private.current_profile_id());

create policy "group_join_requests_create_own"
on public.group_join_requests
for insert
to authenticated
with check (
  profile_id = private.current_profile_id()
  and exists (
    select 1
    from public.profiles as profile
    join public.groups as group_record on group_record.id = group_join_requests.group_id
    where profile.id = group_join_requests.profile_id
      and profile.type in ('student', 'alumni')
      and group_record.join_policy = 'request'
  )
  and not private.is_group_member(group_id)
);

create policy "group_join_requests_delete_own"
on public.group_join_requests
for delete
to authenticated
using (profile_id = private.current_profile_id());

revoke all on table public.groups from anon, authenticated;
revoke all on table public.group_memberships from anon, authenticated;
revoke all on table public.group_join_requests from anon, authenticated;

grant select on table public.groups to authenticated;
grant insert (
  id,
  slug,
  slug_is_custom,
  kind,
  name,
  description,
  join_policy,
  identity_policy,
  posting_policy,
  created_by
) on table public.groups to authenticated;

grant select on table public.group_memberships to authenticated;
grant insert (group_id, profile_id) on table public.group_memberships to authenticated;
grant update (pinned_at) on table public.group_memberships to authenticated;

grant select on table public.group_join_requests to authenticated;
grant insert (group_id, profile_id) on table public.group_join_requests to authenticated;
grant delete on table public.group_join_requests to authenticated;

create function public.discover_groups(
  p_query text default '',
  p_include_joined boolean default false,
  p_limit integer default 24
)
returns table (
  group_id uuid,
  slug text,
  name text,
  description text,
  join_policy public.group_join_policy,
  identity_policy public.group_identity_policy,
  icon_path text,
  cover_path text,
  member_count bigint,
  membership_state text,
  member_role public.group_member_role,
  requested_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  caller_profile public.profiles;
  normalized_query text := lower(regexp_replace(btrim(coalesce(p_query, '')), '[[:space:]]+', '', 'g'));
begin
  select profile.*
  into caller_profile
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if caller_profile.id is null or caller_profile.type = 'teacher' then
    raise exception 'group discovery is not allowed' using errcode = '42501';
  end if;

  return query
  select
    group_record.id,
    group_record.slug,
    group_record.name,
    group_record.description,
    group_record.join_policy,
    group_record.identity_policy,
    group_record.icon_path,
    group_record.cover_path,
    group_record.member_count,
    case
      when membership.profile_id is not null then 'member'
      when join_request.profile_id is not null then 'requested'
      else 'none'
    end,
    membership.role,
    join_request.requested_at
  from public.groups as group_record
  left join public.group_memberships as membership
    on membership.group_id = group_record.id
    and membership.profile_id = caller_profile.id
  left join public.group_join_requests as join_request
    on join_request.group_id = group_record.id
    and join_request.profile_id = caller_profile.id
  where group_record.kind = 'unofficial'
    and group_record.join_policy <> 'invite_only'
    and (p_include_joined or membership.profile_id is null)
    and (normalized_query = '' or group_record.search_name like '%' || normalized_query || '%')
  order by group_record.member_count desc, group_record.id
  limit least(greatest(coalesce(p_limit, 24), 1), 50);
end;
$$;

revoke all on function public.discover_groups(text, boolean, integer) from public;
grant execute on function public.discover_groups(text, boolean, integer) to authenticated;

create function public.list_popular_groups(p_limit integer default 4)
returns table (
  group_id uuid,
  slug text,
  name text,
  description text,
  join_policy public.group_join_policy,
  identity_policy public.group_identity_policy,
  icon_path text,
  cover_path text,
  member_count bigint,
  membership_state text,
  member_role public.group_member_role,
  requested_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  caller_profile public.profiles;
begin
  select profile.*
  into caller_profile
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if caller_profile.id is null or caller_profile.type = 'teacher' then
    return;
  end if;

  return query
  select
    group_record.id,
    group_record.slug,
    group_record.name,
    group_record.description,
    group_record.join_policy,
    group_record.identity_policy,
    group_record.icon_path,
    group_record.cover_path,
    group_record.member_count,
    case when join_request.profile_id is not null then 'requested' else 'none' end,
    null::public.group_member_role,
    join_request.requested_at
  from public.groups as group_record
  left join public.group_memberships as membership
    on membership.group_id = group_record.id
    and membership.profile_id = caller_profile.id
  left join public.group_join_requests as join_request
    on join_request.group_id = group_record.id
    and join_request.profile_id = caller_profile.id
  where group_record.kind = 'unofficial'
    and group_record.join_policy <> 'invite_only'
    and membership.profile_id is null
  order by group_record.member_count desc, group_record.id
  limit least(greatest(coalesce(p_limit, 4), 1), 4);
end;
$$;

revoke all on function public.list_popular_groups(integer) from public;
grant execute on function public.list_popular_groups(integer) to authenticated;

create function public.create_group(
  p_kind public.group_kind,
  p_name text,
  p_description text default '',
  p_slug text default null,
  p_join_policy public.group_join_policy default null,
  p_identity_policy public.group_identity_policy default 'optional_anonymous',
  p_posting_policy public.group_posting_policy default 'members'
)
returns table (group_id uuid, slug text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_profile public.profiles;
  chosen_policy public.group_join_policy;
  chosen_slug text;
  created_group_id uuid := gen_random_uuid();
begin
  select profile.*
  into caller_profile
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if caller_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  if p_kind = 'official'
    and (caller_profile.role <> 'admin' or caller_profile.type = 'teacher') then
    raise exception 'official group creation is not allowed' using errcode = '42501';
  end if;

  chosen_policy := coalesce(
    p_join_policy,
    case
      when p_kind = 'official' then 'open'::public.group_join_policy
      else 'invite_only'::public.group_join_policy
    end
  );

  if chosen_policy = 'invite_only' and nullif(btrim(p_slug), '') is not null then
    raise exception 'invite-only groups cannot use a custom slug' using errcode = '22023';
  end if;

  if chosen_policy = 'invite_only' or nullif(btrim(p_slug), '') is null then
    chosen_slug := 'g-' || encode(extensions.gen_random_bytes(10), 'hex');
  else
    chosen_slug := lower(btrim(p_slug));
  end if;

  perform set_config('app.create_group', '1', true);

  insert into public.groups (
    id,
    slug,
    slug_is_custom,
    kind,
    name,
    description,
    join_policy,
    identity_policy,
    posting_policy,
    created_by
  )
  values (
    created_group_id,
    chosen_slug,
    chosen_policy <> 'invite_only' and nullif(btrim(p_slug), '') is not null,
    p_kind,
    btrim(p_name),
    btrim(coalesce(p_description, '')),
    chosen_policy,
    p_identity_policy,
    p_posting_policy,
    caller_profile.id
  );

  return query select created_group_id, chosen_slug;
end;
$$;

revoke all on function public.create_group(
  public.group_kind,
  text,
  text,
  text,
  public.group_join_policy,
  public.group_identity_policy,
  public.group_posting_policy
) from public;
grant execute on function public.create_group(
  public.group_kind,
  text,
  text,
  text,
  public.group_join_policy,
  public.group_identity_policy,
  public.group_posting_policy
) to authenticated;
