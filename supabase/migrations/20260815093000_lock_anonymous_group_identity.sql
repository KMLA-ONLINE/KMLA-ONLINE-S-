-- 전부 익명으로 모은 그룹은 다른 멤버가 있는 한 익명을 걷을 수 없다. 그리고 공식 그룹의 운영
-- 정책 잠금은 걷어낸다.
--
-- `list_group_members`는 읽는 시점의 `identity_policy`를 보고 이름을 가린다. 정책을 한 번
-- 되돌리면 익명을 전제로 가입한 모든 멤버의 이름·프로필·아바타가 한꺼번에 드러나고 이름 검색까지
-- 열린다. 게시물과 댓글은 행마다 `author_identity`를, 반응은 `is_anonymous`를 박아 두어 과거가
-- 새지 않지만(기능 명세 §10.4) 멤버 명부에는 그런 동결이 없다. 그 구멍은 명부 쪽에서 막을 수
-- 없다 — 지금 멤버가 누구인지는 어차피 현재 정책으로 판단할 수밖에 없다. 그래서 전환 자체를
-- 막는다. `join_policy`가 이미 같은 모양으로 단방향이다(공개 그룹은 비공개가 될 수 없다).
--
-- 소유자 혼자면 지킬 약속을 한 상대가 아직 없으므로 열어 둔다. 만들자마자 알아채는 실수까지
-- 막으면 그룹을 지웠다 다시 만드는 것 말고는 길이 없다.
--
-- 함께, 공식 그룹이라는 이유만으로 정책을 잠그던 규칙을 없앤다. 공식 그룹도 운영하다 보면
-- 가입·신원·글쓰기 방식이 달라진다. 남는 제약은 그룹 종류가 아니라 그룹의 현재 상태에서
-- 나오는 것들뿐이다.
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

  -- 공식 그룹의 운영 정책도 소유자와 관리자가 바꾼다. 아래 세 규칙은 그룹 종류와 무관하게
  -- 지금 그룹의 상태에서만 판단한다.
  if current_group.join_policy <> 'invite_only'
    and p_join_policy = 'invite_only' then
    raise exception 'public groups cannot become private' using errcode = '55000';
  end if;

  if current_group.identity_policy = 'always_anonymous'
    and p_identity_policy <> 'always_anonymous'
    and current_group.member_count > 1 then
    raise exception 'anonymous groups cannot lift anonymity' using errcode = '55000';
  end if;

  -- 공식 그룹은 익명으로 **전환**할 수 없다. 승인된 재학생이 트리거로 자동 가입하므로 멤버가
  -- 항상 둘 이상이고, 그래서 위 규칙에 걸려 영영 되돌릴 수 없게 된다. 한 번의 클릭으로 전교생
  -- 명부가 익명화되고 복구할 수 없는 조합이다.
  --
  -- 처음부터 익명으로 만든 공식 그룹은 그대로 둔다. 그 그룹의 멤버는 익명을 전제로 들어왔다.
  if current_group.kind = 'official'
    and p_identity_policy = 'always_anonymous'
    and current_group.identity_policy <> 'always_anonymous' then
    raise exception 'official groups cannot become anonymous' using errcode = '55000';
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
