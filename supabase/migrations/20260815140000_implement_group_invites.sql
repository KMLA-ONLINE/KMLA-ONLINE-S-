-- 그룹 초대 링크.
--
-- 명세 §7.6은 개인 지정 초대와 공유 링크를 함께 요구하지만, 알림 시스템이 없어 개인 초대가
-- 도착할 곳이 없다. 초대했다는 사실을 앱 밖에서 알려야 한다면 그 연락에 링크를 붙이는 편이
-- 낫다. 그래서 링크 하나로 통일하고, 링크는 그룹당 하나만 살아 있게 한다.
--
-- 토큰은 자격 증명이다. `public`에 두고 정책으로 가리면 정책 한 곳이 틀어질 때 모든 비공개
-- 그룹의 가입 권한이 한꺼번에 새므로 `private`에 두고 전부 definer RPC로만 다룬다.

create table private.group_invites (
  group_id uuid primary key references public.groups (id) on delete cascade,
  token text not null unique,
  created_by bigint not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint group_invites_token_format check (token ~ '^[a-f0-9]{32}$'),
  constraint group_invites_expires_after_creation check (expires_at > created_at)
);

alter table private.group_invites enable row level security;
revoke all on table private.group_invites from anon, authenticated;

create policy "group_invites_deny_client_access"
on private.group_invites
for all
to public
using (false)
with check (false);

-- 발급, 조회, 취소가 공유하는 자격 검사. 읽기만 하므로 stable이고, 그래서 stable인
-- `get_group_invite`가 부를 수 있다.
create function private.assert_group_invite_manager(p_group_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_group public.groups;
  caller_role public.group_member_role;
begin
  select group_record.*
  into target_group
  from public.groups as group_record
  where group_record.id = p_group_id
    and group_record.deleted_at is null;

  if target_group.id is null then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  -- 공식 그룹에는 초대할 사람이 없다. 승인된 재학생은 트리거로 자동 가입하고, 교사는
  -- `sync_student_official_memberships`가 다시 지운다.
  if target_group.kind = 'official' then
    raise exception 'official groups cannot be invited to' using errcode = '55000';
  end if;

  select membership.role
  into caller_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = private.current_profile_id();

  if caller_role is null or caller_role not in ('owner', 'admin') then
    raise exception 'group staff required' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_group_invite_manager(uuid)
from public, anon, authenticated;

-- 살아 있는 링크를 돌려준다. 없거나 만료됐으면 0행 — 그때 화면은 "링크 만들기"를 보여 준다.
-- 설정 화면을 다시 열 때마다 링크가 바뀌면 안 되므로 발급과 분리했다.
create function public.get_group_invite(p_group_id uuid)
returns table (token text, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_group_invite_manager(p_group_id);

  return query
  select invite.token, invite.expires_at
  from private.group_invites as invite
  where invite.group_id = p_group_id
    and invite.expires_at > now();
end;
$$;

-- 발급 또는 재발급. 그룹당 한 행이라 재발급은 곧 이전 링크의 무효화다.
--
-- 기간을 시간으로 받는 것은 한 시간짜리 링크를 만들 수 있어야 하기 때문이다. 상한 336시간은
-- 2주다.
create function public.issue_group_invite(
  p_group_id uuid,
  p_hours integer default 24
)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_token text := encode(extensions.gen_random_bytes(16), 'hex');
begin
  perform private.assert_group_invite_manager(p_group_id);

  if p_hours is null or p_hours < 1 or p_hours > 336 then
    raise exception 'invite lifetime must be between 1 and 336 hours'
      using errcode = '22023';
  end if;

  return query
  insert into private.group_invites as invite (
    group_id, token, created_by, created_at, expires_at
  )
  values (
    p_group_id,
    new_token,
    private.current_profile_id(),
    now(),
    now() + make_interval(hours => p_hours)
  )
  on conflict (group_id) do update
  set token = excluded.token,
    created_by = excluded.created_by,
    created_at = excluded.created_at,
    expires_at = excluded.expires_at
  returning invite.token, invite.expires_at;
end;
$$;

-- 링크를 끊기만 한다. 재발급으로 대신하면 "끊고 싶을 뿐인데 새 링크가 생기는" 동작이 된다.
create function public.revoke_group_invite(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_group_invite_manager(p_group_id);

  delete from private.group_invites as invite
  where invite.group_id = p_group_id;
end;
$$;

-- 링크를 받은 사람이 가입 여부를 판단할 만큼만 보여 준다.
--
-- 이 RPC가 없으면 초대 자체가 성립하지 않는다. `groups_select_visible`은 비공개 그룹의 행을
-- 비멤버에게 통째로 숨기므로, 링크를 그대로 열면 그룹 이름조차 못 보고 404를 만난다.
--
-- 아이콘과 커버는 일부러 빼 놓았다. 그림을 보여 주려면 `can_read_group_media`를 토큰까지
-- 아는 형태로 넓혀야 하는데, 미리보기 한 장을 위해 저장소 접근을 넓힐 이유가 없다.
create function public.get_group_invite_preview(p_token text)
returns table (
  group_id uuid,
  slug text,
  name text,
  description text,
  join_policy public.group_join_policy,
  identity_policy public.group_identity_policy,
  posting_policy public.group_posting_policy,
  member_count bigint,
  expires_at timestamptz,
  already_member boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

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
    )
  from private.group_invites as invite
  join public.groups as group_record on group_record.id = invite.group_id
  where invite.token = p_token
    and invite.expires_at > now()
    and group_record.kind = 'unofficial'
    and group_record.deleted_at is null;
end;
$$;

-- 초대 수락. 그룹 주소를 돌려주므로 라우트가 곧바로 그리로 보낼 수 있다.
create function public.accept_group_invite(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
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

  -- 프로필 종류를 보지 않는다. `group_memberships_join_open` 정책은 교사를 막지만 그 정책이
  -- 막는 것은 "스스로 가입"이고, 초대 수락은 definer라 그 옆을 지난다. 교사는 그룹을 찾을
  -- 수도 가입 요청을 넣을 수도 없으므로 초대가 교사의 유일한 가입 경로다.

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
  where group_record.id = invite_record.group_id
    and group_record.deleted_at is null;

  if invited_group.id is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  -- 발급 시점에도 막지만, 링크가 만들어진 뒤 그룹이 공식으로 바뀌는 경로가 생기더라도
  -- 수락이 뚫리지 않도록 여기서 한 번 더 본다.
  if invited_group.kind = 'official' then
    raise exception 'official groups cannot be invited to' using errcode = '55000';
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
$$;

revoke all on function public.get_group_invite(uuid) from public, anon;
revoke all on function public.issue_group_invite(uuid, integer) from public, anon;
revoke all on function public.revoke_group_invite(uuid) from public, anon;
revoke all on function public.get_group_invite_preview(text) from public, anon;
revoke all on function public.accept_group_invite(text) from public, anon;

grant execute on function public.get_group_invite(uuid) to authenticated;
grant execute on function public.issue_group_invite(uuid, integer) to authenticated;
grant execute on function public.revoke_group_invite(uuid) to authenticated;
grant execute on function public.get_group_invite_preview(text) to authenticated;
grant execute on function public.accept_group_invite(text) to authenticated;
