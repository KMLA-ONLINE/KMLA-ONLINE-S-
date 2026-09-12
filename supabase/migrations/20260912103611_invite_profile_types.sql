-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.get_group_invite_preview(IN p_token text);

DROP FUNCTION public.get_group_invite(IN p_group_id uuid);

DROP FUNCTION public.issue_group_invite(IN p_group_id uuid, IN p_hours integer);

ALTER TABLE private.group_invites
  ADD COLUMN allowed_profile_types public.profile_type[] DEFAULT ARRAY['student'::public.profile_type, 'alumni'::public.profile_type, 'teacher'::public.profile_type] NOT NULL;

ALTER TABLE private.group_invites
  ADD CONSTRAINT group_invites_allowed_profile_types_not_empty CHECK (cardinality(allowed_profile_types) > 0);

CREATE OR REPLACE FUNCTION public.accept_group_invite (
  p_token text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile public.profiles;
  invite_record private.group_invites;
  invited_group public.groups;
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

  select invite.*
  into invite_record
  from private.group_invites as invite
  where invite.token = p_token;

  if invite_record.group_id is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  if invite_record.expires_at <= now() then
    raise exception 'invite expired' using errcode = '55000';
  end if;

  select group_record.*
  into invited_group
  from public.groups as group_record
  where group_record.id = invite_record.group_id;

  if invited_group.id is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  -- 발급 시점에도 막지만, 링크가 만들어진 뒤 그룹이 공식으로 바뀌는 경로가 생기더라도
  -- 수락이 뚫리지 않도록 여기서 한 번 더 본다.
  if invited_group.kind = 'official' then
    raise exception 'official groups cannot be invited to' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = invited_group.id
      and membership.profile_id = caller_profile.id
  ) and not caller_profile.type = any(invite_record.allowed_profile_types) then
    raise exception 'profile type is not allowed by invite' using errcode = '42501';
  end if;

  -- 이미 멤버면 역할을 그대로 둔다. 관리자가 자기 링크를 눌러 멤버로 강등되면 안 된다.
  insert into public.group_memberships (group_id, profile_id, role)
  values (invited_group.id, caller_profile.id, 'member')
  on conflict on constraint group_memberships_pkey do nothing;

  -- 대기 중이던 가입 요청을 걷어 낸다. 남겨 두면 운영진 목록에 유령이 쌓이고, 요청이 남아
  -- 있는 동안에는 `update_group_settings`가 가입 정책 변경도 막는다.
  delete from public.group_join_requests as join_request
  where join_request.group_id = invited_group.id
    and join_request.profile_id = caller_profile.id;

  return invited_group.slug;
end;
$function$;

CREATE FUNCTION public.get_group_invite_preview (
  p_token text
)
  RETURNS TABLE (
    group_id              uuid,
    slug                  text,
    name                  text,
    description           text,
    join_policy           public.group_join_policy,
    identity_policy       public.group_identity_policy,
    posting_policy        public.group_posting_policy,
    member_count          bigint,
    expires_at            timestamp with time zone,
    already_member        boolean,
    allowed_profile_types public.profile_type[],
    profile_type_allowed  boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  caller_profile_type public.profile_type;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select profile.type
  into caller_profile_type
  from public.profiles as profile
  where profile.id = caller_profile_id;

  return query
  select
    group_record.id,
    group_record.slug,
    group_record.name,
    group_record.description,
    group_record.join_policy,
    group_record.identity_policy,
    group_record.posting_policy,
    group_record.member_count,
    invite.expires_at,
    exists (
      select 1
      from public.group_memberships as membership
      where membership.group_id = group_record.id
        and membership.profile_id = caller_profile_id
    ),
    invite.allowed_profile_types,
    caller_profile_type = any(invite.allowed_profile_types)
  from private.group_invites as invite
  join public.groups as group_record on group_record.id = invite.group_id
  where invite.token = p_token
    and invite.expires_at > now()
    and group_record.kind = 'unofficial';
end;
$function$;

REVOKE ALL ON FUNCTION public.get_group_invite_preview(text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_group_invite_preview(text) TO authenticated;

CREATE FUNCTION public.get_group_invite (
  p_group_id uuid
)
  RETURNS TABLE (
    token                 text,
    expires_at            timestamp with time zone,
    allowed_profile_types public.profile_type[]
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.assert_group_invite_manager(p_group_id);

  return query
  select invite.token, invite.expires_at, invite.allowed_profile_types
  from private.group_invites as invite
  where invite.group_id = p_group_id
    and invite.expires_at > now();
end;
$function$;

REVOKE ALL ON FUNCTION public.get_group_invite(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_group_invite(uuid) TO authenticated;

CREATE FUNCTION public.issue_group_invite (
  p_group_id              uuid,
  p_hours                 integer               DEFAULT 24,
  p_allowed_profile_types public.profile_type[] DEFAULT ARRAY['student'::public.profile_type,
  'alumni'::public.profile_type,
  'teacher'::public.profile_type]
)
  RETURNS TABLE (
    token                 text,
    expires_at            timestamp with time zone,
    allowed_profile_types public.profile_type[]
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  new_token text := encode(extensions.gen_random_bytes(16), 'hex');
  normalized_profile_types public.profile_type[];
begin
  perform private.assert_group_invite_manager(p_group_id);

  if p_hours is null or p_hours < 1 or p_hours > 336 then
    raise exception 'invite lifetime must be between 1 and 336 hours'
      using errcode = '22023';
  end if;

  if p_allowed_profile_types is null
    or cardinality(p_allowed_profile_types) = 0
    or array_position(p_allowed_profile_types, null) is not null then
    raise exception 'invite must allow at least one profile type'
      using errcode = '22023';
  end if;

  select array_agg(profile_type order by profile_type)
  into normalized_profile_types
  from (
    select distinct profile_type
    from unnest(p_allowed_profile_types) as allowed(profile_type)
  ) as normalized;

  return query
  insert into private.group_invites as invite (
    group_id, token, created_by, created_at, expires_at, allowed_profile_types
  )
  values (
    p_group_id,
    new_token,
    private.current_profile_id(),
    now(),
    now() + make_interval(hours => p_hours),
    normalized_profile_types
  )
  on conflict (group_id) do update
  set token = excluded.token,
    created_by = excluded.created_by,
    created_at = excluded.created_at,
    expires_at = excluded.expires_at,
    allowed_profile_types = excluded.allowed_profile_types
  returning invite.token, invite.expires_at, invite.allowed_profile_types;
end;
$function$;

REVOKE ALL ON FUNCTION public.issue_group_invite(uuid, integer, public.profile_type[]) FROM PUBLIC;

GRANT ALL ON FUNCTION public.issue_group_invite(uuid, integer, public.profile_type[]) TO authenticated;