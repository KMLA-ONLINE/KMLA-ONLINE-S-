create extension if not exists pg_trgm with schema extensions;

create index groups_search_name_trgm_idx
on public.groups using gin (search_name extensions.gin_trgm_ops)
where kind = 'unofficial'
  and join_policy <> 'invite_only';

alter policy "groups_insert_accepted_creator"
on public.groups
with check (
  (select current_setting('app.create_group', true)) = '1'
  and exists (
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

drop function public.discover_groups(text, boolean, integer);

create function public.discover_groups(
  p_query text default '',
  p_include_joined boolean default false,
  p_after_rank smallint default null,
  p_after_member_count bigint default null,
  p_after_id uuid default null,
  p_limit integer default 13
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
  requested_at timestamptz,
  sort_rank smallint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  caller_profile public.profiles;
  normalized_query text := lower(
    regexp_replace(btrim(coalesce(p_query, '')), '[[:space:]]+', '', 'g')
  );
  cursor_field_count integer := pg_catalog.num_nonnulls(
    p_after_rank,
    p_after_member_count,
    p_after_id
  );
begin
  if cursor_field_count not in (0, 3) then
    raise exception 'all discovery cursor fields are required'
      using errcode = '22023';
  end if;

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
  with ranked_groups as (
    select
      group_record.id as group_id,
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
      end as membership_state,
      membership.role as member_role,
      join_request.requested_at,
      case
        when normalized_query = '' then 0
        when group_record.search_name = normalized_query then 0
        when group_record.search_name like normalized_query || '%' then 1
        else 2
      end::smallint as sort_rank
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
      and (
        normalized_query = ''
        or group_record.search_name like '%' || normalized_query || '%'
      )
  )
  select ranked_group.*
  from ranked_groups as ranked_group
  where p_after_rank is null
    or ranked_group.sort_rank > p_after_rank
    or (
      ranked_group.sort_rank = p_after_rank
      and ranked_group.member_count < p_after_member_count
    )
    or (
      ranked_group.sort_rank = p_after_rank
      and ranked_group.member_count = p_after_member_count
      and ranked_group.group_id > p_after_id
    )
  order by
    ranked_group.sort_rank,
    ranked_group.member_count desc,
    ranked_group.group_id
  limit least(greatest(coalesce(p_limit, 13), 1), 50);
end;
$$;

revoke all on function public.discover_groups(
  text,
  boolean,
  smallint,
  bigint,
  uuid,
  integer
) from public;
grant execute on function public.discover_groups(
  text,
  boolean,
  smallint,
  bigint,
  uuid,
  integer
) to authenticated;
