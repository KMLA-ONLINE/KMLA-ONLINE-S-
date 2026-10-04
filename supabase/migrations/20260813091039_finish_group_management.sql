alter table public.group_memberships
add column id uuid not null default gen_random_uuid();

alter table public.group_memberships
add constraint group_memberships_id_key unique (id);

alter table public.group_join_requests
add column id uuid not null default gen_random_uuid();

alter table public.group_join_requests
add constraint group_join_requests_id_key unique (id);

-- Invite-only slug generation is a creation rule enforced by create_group().
-- Keeping it as a row constraint would make join_policy mutable only for groups
-- that happened to start with a generated slug, despite slug itself being fixed.
alter table public.groups
drop constraint groups_invite_slug_generated;

create index group_memberships_roster_idx
on public.group_memberships (group_id, role, joined_at, id);

create index group_join_requests_moderation_idx
on public.group_join_requests (group_id, requested_at, id);

-- Request creation and group policy changes take the same lock. This prevents a
-- request from appearing while a request-policy group is being changed.
create function private.lock_group_for_join_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_join_policy public.group_join_policy;
begin
  select group_record.join_policy
  into current_join_policy
  from public.groups as group_record
  where group_record.id = new.group_id
  for update;

  if current_join_policy is distinct from 'request' then
    raise exception 'group does not accept join requests' using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function private.lock_group_for_join_request() from public, anon, authenticated;

create trigger group_join_requests_lock_group
before insert on public.group_join_requests
for each row execute function private.lock_group_for_join_request();

create function public.list_group_members(
  p_group_id uuid,
  p_query text default ''
)
returns table (
  membership_id uuid,
  pub_id text,
  name text,
  cohort smallint,
  avatar_path text,
  role public.group_member_role,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  group_identity_policy public.group_identity_policy;
  query_text text := btrim(coalesce(p_query, ''));
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  select group_record.identity_policy
  into group_identity_policy
  from public.groups as group_record
  join public.group_memberships as caller_membership
    on caller_membership.group_id = group_record.id
    and caller_membership.profile_id = caller_profile_id
  where group_record.id = p_group_id;

  if group_identity_policy is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  return query
  select
    membership.id,
    case when group_identity_policy = 'always_anonymous' then null else profile.pub_id end,
    case when group_identity_policy = 'always_anonymous' then null else profile.name end,
    profile.cohort,
    case when group_identity_policy = 'always_anonymous' then null else profile.avatar_path end,
    membership.role,
    membership.joined_at
  from public.group_memberships as membership
  join public.profiles as profile on profile.id = membership.profile_id
  where membership.group_id = p_group_id
    and (
      query_text = ''
      or profile.cohort::text like '%' || query_text || '%'
      or (
        group_identity_policy <> 'always_anonymous'
        and profile.name ilike '%' || query_text || '%'
      )
    )
  order by membership.role, membership.joined_at, membership.id;
end;
$$;

create function public.list_group_join_requests(p_group_id uuid)
returns table (
  request_id uuid,
  pub_id text,
  name text,
  cohort smallint,
  avatar_path text,
  requested_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  group_identity_policy public.group_identity_policy;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  select group_record.identity_policy
  into group_identity_policy
  from public.groups as group_record
  join public.group_memberships as caller_membership
    on caller_membership.group_id = group_record.id
    and caller_membership.profile_id = caller_profile_id
    and caller_membership.role in ('owner', 'admin')
  where group_record.id = p_group_id;

  if group_identity_policy is null then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  return query
  select
    join_request.id,
    case when group_identity_policy = 'always_anonymous' then null else profile.pub_id end,
    case when group_identity_policy = 'always_anonymous' then null else profile.name end,
    profile.cohort,
    case when group_identity_policy = 'always_anonymous' then null else profile.avatar_path end,
    join_request.requested_at
  from public.group_join_requests as join_request
  join public.profiles as profile on profile.id = join_request.profile_id
  where join_request.group_id = p_group_id
  order by join_request.requested_at, join_request.id;
end;
$$;

create function public.approve_group_join_request(
  p_group_id uuid,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  requested_profile_id bigint;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  perform 1 from public.groups where id = p_group_id for update;

  if not exists (
    select 1
    from public.group_memberships as caller_membership
    where caller_membership.group_id = p_group_id
      and caller_membership.profile_id = caller_profile_id
      and caller_membership.role in ('owner', 'admin')
  ) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  delete from public.group_join_requests as join_request
  where join_request.group_id = p_group_id
    and join_request.id = p_request_id
  returning join_request.profile_id into requested_profile_id;

  if requested_profile_id is null then
    raise exception 'join request not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = requested_profile_id
      and profile.status = 'accepted'
      and profile.type in ('student', 'alumni')
      and profile.deleted_at is null
  ) then
    raise exception 'requesting profile is no longer eligible' using errcode = '55000';
  end if;

  insert into public.group_memberships (group_id, profile_id, role)
  values (p_group_id, requested_profile_id, 'member')
  on conflict on constraint group_memberships_pkey do nothing;
end;
$$;

create function public.reject_group_join_request(
  p_group_id uuid,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  perform 1 from public.groups where id = p_group_id for update;

  if not exists (
    select 1
    from public.group_memberships as caller_membership
    where caller_membership.group_id = p_group_id
      and caller_membership.profile_id = caller_profile_id
      and caller_membership.role in ('owner', 'admin')
  ) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  delete from public.group_join_requests as join_request
  where join_request.group_id = p_group_id
    and join_request.id = p_request_id;

  if not found then
    raise exception 'join request not found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.update_group_member_role(
  p_group_id uuid,
  p_membership_id uuid,
  p_role public.group_member_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  caller_role public.group_member_role;
  target_role public.group_member_role;
begin
  if auth.uid() is null or caller_profile_id is null or p_role = 'owner' then
    raise exception 'role change is not allowed' using errcode = '42501';
  end if;

  select membership.role
  into caller_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = caller_profile_id
  for update;

  select membership.role
  into target_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.id = p_membership_id
  for update;

  if caller_role not in ('owner', 'admin') or target_role is null or target_role = 'owner' then
    raise exception 'role change is not allowed' using errcode = '42501';
  end if;

  update public.group_memberships
  set role = p_role
  where group_id = p_group_id
    and id = p_membership_id;
end;
$$;

create function public.transfer_group_ownership(
  p_group_id uuid,
  p_target_membership_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  owner_membership_id uuid;
  target_role public.group_member_role;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group owner required' using errcode = '42501';
  end if;

  perform 1 from public.groups where id = p_group_id for update;

  select membership.id
  into owner_membership_id
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = caller_profile_id
    and membership.role = 'owner'
  for update;

  select membership.role
  into target_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.id = p_target_membership_id
  for update;

  if owner_membership_id is null or target_role is distinct from 'admin' then
    raise exception 'ownership can only be transferred to an administrator'
      using errcode = '42501';
  end if;

  update public.group_memberships
  set role = 'admin'
  where id = owner_membership_id;

  update public.group_memberships
  set role = 'owner'
  where id = p_target_membership_id;
end;
$$;

create function public.update_group_settings(
  p_group_id uuid,
  p_name text,
  p_description text,
  p_join_policy public.group_join_policy,
  p_identity_policy public.group_identity_policy,
  p_posting_policy public.group_posting_policy
)
returns table (
  name text,
  description text,
  join_policy public.group_join_policy,
  identity_policy public.group_identity_policy,
  posting_policy public.group_posting_policy,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  current_join_policy public.group_join_policy;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  select group_record.join_policy
  into current_join_policy
  from public.groups as group_record
  where group_record.id = p_group_id
  for update;

  if not exists (
    select 1
    from public.group_memberships as caller_membership
    where caller_membership.group_id = p_group_id
      and caller_membership.profile_id = caller_profile_id
      and caller_membership.role in ('owner', 'admin')
  ) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  if current_join_policy = 'request'
    and p_join_policy <> 'request'
    and exists (
      select 1
      from public.group_join_requests as join_request
      where join_request.group_id = p_group_id
    ) then
    raise exception 'pending join requests must be resolved first' using errcode = '55000';
  end if;

  return query
  update public.groups as group_record
  set
    name = btrim(p_name),
    description = btrim(coalesce(p_description, '')),
    join_policy = p_join_policy,
    identity_policy = p_identity_policy,
    posting_policy = p_posting_policy
  where group_record.id = p_group_id
  returning
    group_record.name,
    group_record.description,
    group_record.join_policy,
    group_record.identity_policy,
    group_record.posting_policy,
    group_record.updated_at;
end;
$$;

revoke all on function public.list_group_members(uuid, text) from public, anon;
revoke all on function public.list_group_join_requests(uuid) from public, anon;
revoke all on function public.approve_group_join_request(uuid, uuid) from public, anon;
revoke all on function public.reject_group_join_request(uuid, uuid) from public, anon;
revoke all on function public.update_group_member_role(uuid, uuid, public.group_member_role) from public, anon;
revoke all on function public.transfer_group_ownership(uuid, uuid) from public, anon;
revoke all on function public.update_group_settings(
  uuid,
  text,
  text,
  public.group_join_policy,
  public.group_identity_policy,
  public.group_posting_policy
) from public, anon;

grant execute on function public.list_group_members(uuid, text) to authenticated;
grant execute on function public.list_group_join_requests(uuid) to authenticated;
grant execute on function public.approve_group_join_request(uuid, uuid) to authenticated;
grant execute on function public.reject_group_join_request(uuid, uuid) to authenticated;
grant execute on function public.update_group_member_role(uuid, uuid, public.group_member_role) to authenticated;
grant execute on function public.transfer_group_ownership(uuid, uuid) to authenticated;
grant execute on function public.update_group_settings(
  uuid,
  text,
  text,
  public.group_join_policy,
  public.group_identity_policy,
  public.group_posting_policy
) to authenticated;
