-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.delete_group (
  p_group_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_group public.groups;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group owner required' using errcode = '42501';
  end if;

  select group_record.* into target_group
  from public.groups as group_record
  where group_record.id = p_group_id and group_record.deleted_at is null
  for update;
  if target_group.id is null then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  -- 공식 그룹은 일반 그룹 운영 권한과 분리한다. 앱 관리자는 소유자·멤버십과 무관하게 학교
  -- 공간을 정리할 수 있지만, 비공식 그룹은 계속 소유자만 지운다.
  if target_group.kind = 'official' then
    perform private.require_app_admin();
  elsif not exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = p_group_id
      and membership.profile_id = caller_profile_id
      and membership.role = 'owner'
  ) then
    raise exception 'group owner required' using errcode = '42501';
  end if;

  update public.groups
  set deleted_at = now(), icon_path = null, cover_path = null
  where id = p_group_id;

  -- 저장소를 돌려받는다. 청소 워커가 집어 갈 수 있게 tombstone만 찍고 객체는 건드리지 않는다.
  update public.group_media_objects
  set status = 'deleted', deleted_at = now(),
    cleanup_lease_id = null, cleanup_lease_expires_at = null
  where group_id = p_group_id and status <> 'deleted';

  update public.post_attachments as attachment
  set status = 'deleted', deleted_at = now(),
    cleanup_lease_id = null, cleanup_lease_expires_at = null
  where attachment.status <> 'deleted'
    and exists (
      select 1 from public.posts as post
      where post.id = attachment.post_id and post.group_id = p_group_id
    );

  update public.posts
  set deleted_at = now(), pinned_at = null
  where group_id = p_group_id and deleted_at is null;

  delete from public.group_join_requests where group_id = p_group_id;
  delete from public.group_memberships where group_id = p_group_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.delete_group(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_group(uuid) TO authenticated;

ALTER POLICY groups_select_visible ON public.groups USING (((deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM public.profiles profile
  WHERE
    ((profile.id = private.current_profile_id()) AND (((profile.role = 'admin'::public.app_role) AND (groups.kind = 'official'::public.group_kind)) OR ((profile.type = ANY
    (ARRAY['student'::public.profile_type, 'alumni'::public.profile_type])) AND
    ((groups.kind = 'official'::public.group_kind) OR ((groups.kind = 'unofficial'::public.group_kind) AND (groups.join_policy <> 'invite_only'::public.group_join_policy)))) OR
    ((groups.kind = 'unofficial'::public.group_kind) AND private.is_group_member(groups.id))))))));
