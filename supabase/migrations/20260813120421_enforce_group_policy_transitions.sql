create or replace function public.update_group_settings(
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
  current_group public.groups%rowtype;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  select group_record.*
  into current_group
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

  if current_group.kind = 'official'
    and (
      p_join_policy is distinct from current_group.join_policy
      or p_identity_policy is distinct from current_group.identity_policy
      or p_posting_policy is distinct from current_group.posting_policy
    ) then
    raise exception 'official group policies cannot be changed' using errcode = '55000';
  end if;

  if current_group.join_policy <> 'invite_only'
    and p_join_policy = 'invite_only' then
    raise exception 'public groups cannot become private' using errcode = '55000';
  end if;

  if current_group.join_policy = 'request'
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
