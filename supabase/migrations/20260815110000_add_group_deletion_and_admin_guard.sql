-- 그룹 삭제(소유자 전용)와 관리자 역할 보호.

-- 삭제는 tombstone이다. 그룹 행을 통째로 지우면 게시물·첨부·그룹 이미지 메타데이터가 cascade로
-- 함께 사라지는데, 저장소 청소 워커는 바로 그 메타데이터를 보고 객체를 지운다. 행이 먼저
-- 사라지면 버킷에 아무도 모르는 파일만 남는다. 프로필·게시물·댓글이 전부 `deleted_at`을 쓰는
-- 이유와 같다.
alter table public.groups add column deleted_at timestamptz;

-- 지운 그룹은 아무에게도 보이지 않는다. 그룹 목록·찾기·상세가 모두 `security invoker`라
-- (`discover_groups`, `list_popular_groups`, 그리고 테이블 직접 조회) 이 정책 한 줄이 세 경로를
-- 한꺼번에 덮는다.
drop policy "groups_select_visible" on public.groups;

create policy "groups_select_visible"
on public.groups
for select
to authenticated
using (
  groups.deleted_at is null
  and exists (
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

-- 관리자를 세우고 내리는 일은 소유자만 한다.
--
-- 관리자끼리 서로 강등할 수 있으면 둘이 번갈아 내리는 상황을 그룹이 스스로 정리하지 못한다.
-- 임명도 같은 이유로 소유자에게 둔다 — 관리자가 관리자를 만들 수 있으면 정리는 소유자만 할 수
-- 있는데 늘리는 것은 아무나 할 수 있어서, 소유자가 자리를 비운 동안 관리자 수가 한 방향으로만
-- 늘어난다.
--
-- 관리자는 여전히 매니저를 세우고 내릴 수 있다. 매니저는 예나 지금이나 아무 역할도 바꾸지
-- 못한다.
create or replace function public.update_group_member_role(
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

  if p_role = 'admin' and caller_role <> 'owner' then
    raise exception 'only the owner can appoint an administrator' using errcode = '42501';
  end if;

  if target_role = 'admin' and caller_role <> 'owner' then
    raise exception 'only the owner can change an administrator' using errcode = '42501';
  end if;

  update public.group_memberships
  set role = p_role
  where group_id = p_group_id
    and id = p_membership_id;
end;
$$;

-- 그룹을 없앤다. 비공식 그룹의 소유자만 할 수 있다.
--
-- 멤버십을 지우는 것이 삭제의 핵심이다. 멤버가 없으면 멤버십을 확인하는 모든 RPC(게시물 목록,
-- 상세, 댓글, 반응, 명부, 설정)가 이미 있는 검사 그대로 42501을 내고, 홈의 내 그룹 목록도
-- 멤버십에서 나오므로 함께 사라진다. 새로 막을 곳이 없다.
--
-- slug와 공식 그룹 이름은 계속 점유한다. 지운 그룹의 주소를 다른 그룹이 가져가면 예전 링크가
-- 엉뚱한 그룹을 열게 된다.
create function public.delete_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

  if not exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = p_group_id
      and membership.profile_id = caller_profile_id
      and membership.role = 'owner'
  ) then
    raise exception 'group owner required' using errcode = '42501';
  end if;

  -- 공식 그룹은 소유자도 지울 수 없다. 승인된 재학생이 자동으로 가입하는 학교의 공간이라
  -- 한 사람의 결정으로 사라져서는 안 된다. 사용자가 공식 그룹에서 나갈 수 없는 것과 같은 이유다.
  if target_group.kind = 'official' then
    raise exception 'official groups cannot be deleted' using errcode = '55000';
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
$$;

revoke all on function public.delete_group(uuid) from public, anon;
grant execute on function public.delete_group(uuid) to authenticated;
