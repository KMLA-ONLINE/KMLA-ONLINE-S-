begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

-- 인증 사용자는 seed에서 공개 비공식 그룹의 멤버가 아니므로 여기서 멤버로 만든다.
insert into public.group_memberships (group_id, profile_id, role)
values (
  '20000000-0000-0000-0000-000000000003',
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001'),
  'member'
);

set local role anon;

select throws_ok(
  $$delete from public.group_memberships$$,
  '42501',
  null,
  'anonymous users have no membership delete access'
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

-- RLS는 허용되지 않은 삭제를 오류가 아니라 0행 삭제로 처리한다. 거부 검증은
-- 오류가 아니라 남아 있는 행으로 확인한다.
delete from public.group_memberships
where group_id = '20000000-0000-0000-0000-000000000002'
  and profile_id = private.current_profile_id();

select is(
  (
    select count(*)
    from public.group_memberships
    where group_id = '20000000-0000-0000-0000-000000000002'
      and profile_id = private.current_profile_id()
  ),
  1::bigint,
  'group owner cannot leave before transferring ownership'
);

delete from public.group_memberships
where group_id = '20000000-0000-0000-0000-000000000001'
  and profile_id = private.current_profile_id();

select is(
  (
    select count(*)
    from public.group_memberships
    where group_id = '20000000-0000-0000-0000-000000000001'
      and profile_id = private.current_profile_id()
  ),
  1::bigint,
  'official group membership cannot be left directly'
);

delete from public.group_memberships
where group_id = '20000000-0000-0000-0000-000000000003'
  and profile_id <> private.current_profile_id();

reset role;

select is(
  (
    select count(*)
    from public.group_memberships
    where group_id = '20000000-0000-0000-0000-000000000003'
  ),
  5::bigint,
  'a member cannot remove another profile membership'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select lives_ok(
  $$delete from public.group_memberships
    where group_id = '20000000-0000-0000-0000-000000000003'
      and profile_id = private.current_profile_id()$$,
  'unofficial group member can leave'
);

select is(
  (
    select count(*)
    from public.group_memberships
    where group_id = '20000000-0000-0000-0000-000000000003'
      and profile_id = private.current_profile_id()
  ),
  0::bigint,
  'leaving removes the membership row'
);

reset role;

select is(
  (select member_count from public.groups where id = '20000000-0000-0000-0000-000000000003'),
  4::bigint,
  'leaving decrements the public member count'
);

select * from finish();
rollback;
