-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.list_group_join_requests(IN p_group_id uuid);

DROP FUNCTION public.list_group_members(IN p_group_id uuid, IN p_query text, IN p_after_role public.group_member_role, IN p_after_joined_at timestamp
  WITH time zone, IN p_after_membership_id uuid, IN p_limit integer);

CREATE FUNCTION public.list_group_join_requests (
  p_group_id uuid
)
  RETURNS TABLE (
    request_id           uuid,
    pub_id               text,
    name                 text,
    cohort               smallint,
    is_returning_student boolean,
    avatar_path          text,
    requested_at         timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_profile_id is null or not exists (
    select 1 from public.group_memberships as caller_membership
    where caller_membership.group_id = p_group_id
      and caller_membership.profile_id = caller_profile_id
      and caller_membership.role in ('owner', 'admin')
  ) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  return query
  select join_request.id, profile.pub_id, profile.name, profile.cohort,
    profile.is_returning_student, profile.avatar_path, join_request.requested_at
  from public.group_join_requests as join_request
  join public.profiles as profile on profile.id = join_request.profile_id
  where join_request.group_id = p_group_id
  order by join_request.requested_at, join_request.id;
end;
$function$;

REVOKE ALL ON FUNCTION public.list_group_join_requests(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_group_join_requests(uuid) TO authenticated;

CREATE FUNCTION public.list_group_members (
  p_group_id            uuid,
  p_query               text                     DEFAULT ''::text,
  p_after_role          public.group_member_role DEFAULT NULL::public.group_member_role,
  p_after_joined_at     timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_after_membership_id uuid                     DEFAULT NULL::uuid,
  p_limit               integer                  DEFAULT 30
)
  RETURNS TABLE (
    membership_id        uuid,
    pub_id               text,
    name                 text,
    cohort               smallint,
    is_returning_student boolean,
    avatar_path          text,
    role                 public.group_member_role,
    joined_at            timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  query_text text := btrim(coalesce(p_query, ''));
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'member page limit must be between 1 and 100' using errcode = '22023';
  end if;
  if (p_after_role is null) <> (p_after_joined_at is null)
    or (p_after_role is null) <> (p_after_membership_id is null) then
    raise exception 'member cursor must be complete' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.group_memberships as caller_membership
    where caller_membership.group_id = p_group_id
      and caller_membership.profile_id = caller_profile_id
  ) then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  return query
  select membership.id, profile.pub_id, profile.name, profile.cohort,
    profile.is_returning_student, profile.avatar_path, membership.role,
    membership.joined_at
  from public.group_memberships as membership
  join public.profiles as profile on profile.id = membership.profile_id
  where membership.group_id = p_group_id
    and (
      query_text = ''
      -- 명부가 복학생을 n.5기로 보여 주므로 검색도 표시값을 기준으로 한다.
      -- 표시값은 저장된 기수를 접두사로 포함하므로 '20'은 20기와 20.5기를 모두 찾는다.
      or (
        profile.cohort
          + case when profile.is_returning_student then 0.5 else 0 end
      )::text like '%' || query_text || '%'
      or profile.name ilike '%' || query_text || '%'
    )
    and (
      p_after_role is null
      or (membership.role, membership.joined_at, membership.id)
        > (p_after_role, p_after_joined_at, p_after_membership_id)
    )
  order by membership.role, membership.joined_at, membership.id
  limit p_limit;
end;
$function$;

REVOKE ALL ON FUNCTION public.list_group_members(uuid, text, public.group_member_role, timestamp WITH time zone, uuid, integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_group_members(uuid, text, public.group_member_role, timestamp WITH time zone, uuid, integer) TO authenticated;