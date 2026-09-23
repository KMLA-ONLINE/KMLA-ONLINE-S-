-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

DROP FUNCTION
  public.create_group(IN p_kind public.group_kind, IN p_name text, IN p_description text, IN p_slug text, IN p_join_policy public.group_join_policy, IN p_identity_policy
  public.group_identity_policy, IN p_posting_policy public.group_posting_policy);

DROP FUNCTION
  public.update_group_settings(IN p_group_id uuid, IN p_name text, IN p_description text, IN p_join_policy public.group_join_policy, IN p_identity_policy
  public.group_identity_policy, IN p_posting_policy public.group_posting_policy);

ALTER TABLE public.groups
  ADD COLUMN hide_staff_roles boolean DEFAULT false NOT NULL;

CREATE OR REPLACE FUNCTION private.notify_group_changed()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor_profile_id bigint := private.current_profile_id();
  recipient record;
  event_kind public.notification_kind;
  event_importance public.notification_importance;
  event_title text;
begin
  if actor_profile_id is null then return new; end if;
  -- 그룹 삭제 알림은 여기서 보내지 않는다. 삭제가 UPDATE 가 아니라 DELETE 라 트리거가 볼 수
  -- 없고, 알림이 그룹 이름을 제목에 실어야 하기 때문이다. public.delete_group 이 보낸다.
  if old.join_policy is distinct from new.join_policy
    or old.identity_policy is distinct from new.identity_policy
    or old.posting_policy is distinct from new.posting_policy
    or old.hide_staff_roles is distinct from new.hide_staff_roles then
    event_kind := 'group_policy_changed';
    event_importance := 'normal';
    event_title := '그룹 운영 정책이 변경되었습니다.';
  else
    return new;
  end if;

  for recipient in select profile_id from public.group_memberships where group_id = new.id
  loop
    perform private.emit_notification(
      'group-change:' || new.id::text || ':' || txid_current()::text || ':' || recipient.profile_id::text,
      recipient.profile_id, event_kind, event_importance, 'group', 'staff',
      actor_profile_id, '운영진', null, event_title, new.id
    );
  end loop;
  return new;
end;
$function$;

CREATE FUNCTION public.create_group (
  p_kind             public.group_kind,
  p_name             text,
  p_description      text                         DEFAULT ''::text,
  p_slug             text                         DEFAULT NULL::text,
  p_join_policy      public.group_join_policy     DEFAULT NULL::public.group_join_policy,
  p_identity_policy  public.group_identity_policy DEFAULT 'optional_anonymous'::public.group_identity_policy,
  p_posting_policy   public.group_posting_policy  DEFAULT 'members'::public.group_posting_policy,
  p_hide_staff_roles boolean                      DEFAULT false
)
  RETURNS TABLE (
    group_id uuid,
    slug     text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile public.profiles;
  chosen_policy public.group_join_policy;
  chosen_slug text;
  created_group_id uuid := gen_random_uuid();
begin
  if auth.uid() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

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
    chosen_slug := encode(extensions.gen_random_bytes(7), 'hex');
  else
    chosen_slug := lower(btrim(p_slug));
  end if;

  insert into public.groups (
    id, slug, slug_is_custom, kind, name, description, join_policy,
    identity_policy, posting_policy, hide_staff_roles, created_by
  ) values (
    created_group_id,
    chosen_slug,
    chosen_policy <> 'invite_only' and nullif(btrim(p_slug), '') is not null,
    p_kind,
    btrim(p_name),
    btrim(coalesce(p_description, '')),
    chosen_policy,
    p_identity_policy,
    p_posting_policy,
    p_hide_staff_roles,
    caller_profile.id
  );

  return query select created_group_id, chosen_slug;
end;
$function$;

REVOKE ALL ON FUNCTION public.create_group(public.group_kind, text, text, text, public.group_join_policy, public.group_identity_policy, public.group_posting_policy, boolean) FROM
  PUBLIC;

GRANT ALL ON FUNCTION public.create_group(public.group_kind, text, text, text, public.group_join_policy, public.group_identity_policy, public.group_posting_policy, boolean) TO
  authenticated;

CREATE OR REPLACE FUNCTION public.list_group_members (
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
  caller_role public.group_member_role;
  roles_visible boolean;
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
  select caller_membership.role,
    not group_record.hide_staff_roles
      or caller_membership.role in ('owner', 'admin')
  into caller_role, roles_visible
  from public.groups as group_record
  join public.group_memberships as caller_membership
    on caller_membership.group_id = group_record.id
   and caller_membership.profile_id = caller_profile_id
  where group_record.id = p_group_id;

  if caller_role is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  return query
  select membership.id, profile.pub_id, profile.name, profile.cohort,
    profile.is_returning_student, profile.avatar_path,
    case when roles_visible then membership.role else 'member'::public.group_member_role end,
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
      or (
        roles_visible
        and (membership.role, membership.joined_at, membership.id)
          > (p_after_role, p_after_joined_at, p_after_membership_id)
      )
      or (
        not roles_visible
        and (membership.joined_at, membership.id)
          > (p_after_joined_at, p_after_membership_id)
      )
    )
  order by
    case when roles_visible then membership.role else 'member'::public.group_member_role end,
    membership.joined_at,
    membership.id
  limit p_limit;
end;
$function$;

CREATE FUNCTION public.update_group_settings (
  p_group_id         uuid,
  p_name             text,
  p_description      text,
  p_join_policy      public.group_join_policy,
  p_identity_policy  public.group_identity_policy,
  p_posting_policy   public.group_posting_policy,
  p_hide_staff_roles boolean
)
  RETURNS TABLE (
    name             text,
    description      text,
    join_policy      public.group_join_policy,
    identity_policy  public.group_identity_policy,
    posting_policy   public.group_posting_policy,
    hide_staff_roles boolean,
    updated_at       timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  current_group public.groups%rowtype;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group administrator required' using errcode = '42501';
  end if;
  select group_record.* into current_group
  from public.groups as group_record
  where group_record.id = p_group_id
  for update;
  if not exists (
    select 1 from public.group_memberships as caller_membership
    where caller_membership.group_id = p_group_id
      and caller_membership.profile_id = caller_profile_id
      and caller_membership.role in ('owner', 'admin')
  ) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;
  if current_group.join_policy <> 'invite_only' and p_join_policy = 'invite_only' then
    raise exception 'public groups cannot become private' using errcode = '55000';
  end if;
  if current_group.join_policy = 'request' and p_join_policy <> 'request' and exists (
    select 1 from public.group_join_requests as join_request
    where join_request.group_id = p_group_id
  ) then
    raise exception 'pending join requests must be resolved first' using errcode = '55000';
  end if;

  return query
  update public.groups as group_record
  set name = btrim(p_name), description = btrim(coalesce(p_description, '')),
    join_policy = p_join_policy, identity_policy = p_identity_policy,
    posting_policy = p_posting_policy, hide_staff_roles = p_hide_staff_roles
  where group_record.id = p_group_id
  returning group_record.name, group_record.description, group_record.join_policy,
    group_record.identity_policy, group_record.posting_policy,
    group_record.hide_staff_roles, group_record.updated_at;
end;
$function$;

REVOKE ALL ON FUNCTION public.update_group_settings(uuid, text, text, public.group_join_policy, public.group_identity_policy, public.group_posting_policy, boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.update_group_settings(uuid, text, text, public.group_join_policy, public.group_identity_policy, public.group_posting_policy, boolean) TO authenticated;

CREATE OR REPLACE TRIGGER groups_notify_changed
  AFTER UPDATE OF join_policy, identity_policy, posting_policy, hide_staff_roles ON public.groups
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_group_changed();
