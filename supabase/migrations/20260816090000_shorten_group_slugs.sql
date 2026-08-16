-- 그룹 주소를 짧게 줄이고, 자동 생성 주소에서 `g-` 접두사를 걷어낸다.
--
-- `g-8f2a1c4e6b9d7a3c5e10`은 22자다. 주소창에 붙으면 그룹 이름보다 길고, 공유할 때 줄바꿈에
-- 걸리고, 손으로 옮겨 적기도 어렵다. 접두사 `g-`는 아무것도 구분해 주지 않는다 — 이미 경로가
-- `/groups/`로 시작하므로 맥락은 URL이 말해 준다.
--
-- 임의 주소는 10바이트(20자)에서 7바이트(14자)로 줄인다. 56비트는 초대 전용 그룹 주소를
-- 추측으로 찾아내기에 여전히 충분하고, 사용자 지정 주소의 새 상한 15자 안에 들어온다.
--
-- 사용자 지정 주소는 3~50자에서 4~15자로 좁힌다. 50자짜리 주소는 아무도 쓰지 않았고, 짧은
-- 주소가 이 기능의 요점이다. 3자는 의미 있는 이름을 담기에 너무 짧아 오타나 선점에 가깝다.
--
-- 기존 행도 전부 새 형식으로 옮긴다. 아직 서비스 중인 링크가 없으므로 지금이 아니면 영영
-- 두 형식을 함께 이고 가야 한다.

-- 자동 생성 주소의 모양은 행 제약으로 묶지 않는다. 20260813091039에서 그 제약을 걷어낸
-- 이유가 그대로 유효하다 — 생성 시점 규칙이지 행이 항상 만족해야 하는 성질이 아니다.
-- 여기서는 길이 제약만 다시 세운다.
alter table public.groups drop constraint groups_slug_format;

-- 자동 생성 주소를 새 형식으로 다시 뽑는다. 사용자가 지은 주소는 건드리지 않는다.
update public.groups
set slug = encode(extensions.gen_random_bytes(7), 'hex')
where slug ~ '^g-[a-f0-9]{20}$';

alter table public.groups add constraint groups_slug_format check (
  char_length(slug) between 4 and 15
  and slug ~ '^[a-z0-9][a-z0-9-]{2,13}[a-z0-9]$'
);

create or replace function public.create_group(
  p_kind public.group_kind,
  p_name text,
  p_description text default '',
  p_slug text default null,
  p_join_policy public.group_join_policy default null,
  p_identity_policy public.group_identity_policy default 'optional_anonymous',
  p_posting_policy public.group_posting_policy default 'members'
)
returns table (group_id uuid, slug text)
language plpgsql
security definer
set search_path = ''
as $$
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
    identity_policy, posting_policy, created_by
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
    caller_profile.id
  );

  return query select created_group_id, chosen_slug;
end;
$$;
