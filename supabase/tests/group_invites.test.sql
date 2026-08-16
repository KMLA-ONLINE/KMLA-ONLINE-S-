begin;

create extension if not exists pgtap with schema extensions;
select plan(33);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000',
  user_id,
  'authenticated',
  'authenticated',
  email,
  '',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now()
from (values
  ('10000000-0000-0000-0000-000000000002'::uuid, 'official-owner@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000003'::uuid, 'private-admin@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000004'::uuid, 'private-manager@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000005'::uuid, 'private-member@kmla.hs.kr')
) as users(user_id, email);

update public.profiles
set auth_user_id = case pub_id
  when 'kim-admin' then '10000000-0000-0000-0000-000000000002'::uuid
  when 'hanbyeol-25' then '10000000-0000-0000-0000-000000000003'::uuid
  when 'saebyeok-24' then '10000000-0000-0000-0000-000000000004'::uuid
  when 'pureum-23' then '10000000-0000-0000-0000-000000000005'::uuid
end
where pub_id in ('kim-admin', 'hanbyeol-25', 'saebyeok-24', 'pureum-23');

-- 승인제 그룹(필름 서클)에 대기 중인 요청. 초대를 수락하면 이 행이 걷혀야 한다.
insert into public.group_join_requests (group_id, profile_id, requested_at)
values (
  '20000000-0000-0000-0000-000000000006',
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001'),
  '2026-02-01 00:00:00+00'
);

-- 발급한 토큰을 뒤 단계에서 다시 쓰기 위한 보관함. RPC가 매번 새 토큰을 만들기 때문에
-- 어딘가에 붙들어 두지 않으면 "재발급이 이전 링크를 끊는다"를 확인할 수 없다.
create temporary table invite_probe (label text primary key, token text not null);
grant select, insert on invite_probe to authenticated;

select ok(
  not has_table_privilege('authenticated', 'private.group_invites', 'SELECT'),
  'invite tokens are not readable through the table API'
);
select ok(
  not has_table_privilege('anon', 'private.group_invites', 'INSERT'),
  'invite tokens cannot be written through the table API'
);
select ok(
  has_function_privilege('authenticated', 'public.accept_group_invite(text)', 'EXECUTE'),
  'accepting an invite is granted to signed-in users'
);
select ok(
  not has_function_privilege('anon', 'public.get_group_invite_preview(text)', 'EXECUTE'),
  'signed-out visitors cannot preview an invite'
);

-- 일반 멤버
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
set local role authenticated;

select throws_ok(
  $$select * from public.issue_group_invite('20000000-0000-0000-0000-000000000002', 1)$$,
  '42501',
  'group staff required',
  'a plain member cannot create an invite link'
);
select throws_ok(
  $$select * from public.get_group_invite('20000000-0000-0000-0000-000000000002')$$,
  '42501',
  'group staff required',
  'a plain member cannot read the invite link'
);
select throws_ok(
  $$select public.revoke_group_invite('20000000-0000-0000-0000-000000000002')$$,
  '42501',
  'group staff required',
  'a plain member cannot revoke the invite link'
);

-- 매니저. 카테고리와 게시물은 손대지만 사람을 들이지는 못한다.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;

select throws_ok(
  $$select * from public.issue_group_invite('20000000-0000-0000-0000-000000000002', 1)$$,
  '42501',
  'group staff required',
  'a manager cannot create an invite link'
);

-- 관리자
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

insert into invite_probe
select 'first', token
from public.issue_group_invite('20000000-0000-0000-0000-000000000002', 1);

select matches(
  (select token from invite_probe where label = 'first'),
  '^[a-f0-9]{32}$',
  'an administrator can create an invite link'
);

-- 소유자
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is(
  (select token from public.get_group_invite('20000000-0000-0000-0000-000000000002')),
  (select token from invite_probe where label = 'first'),
  'the group has one link, so the owner reads what the administrator made'
);
select throws_ok(
  $$select * from public.issue_group_invite('20000000-0000-0000-0000-000000000002', 0)$$,
  '22023',
  'invite lifetime must be between 1 and 336 hours',
  'an invite cannot live for less than an hour'
);
select throws_ok(
  $$select * from public.issue_group_invite('20000000-0000-0000-0000-000000000002', 337)$$,
  '22023',
  'invite lifetime must be between 1 and 336 hours',
  'an invite cannot outlive two weeks'
);

insert into invite_probe
select 'second', token
from public.issue_group_invite('20000000-0000-0000-0000-000000000002', 12);

select isnt(
  (select token from invite_probe where label = 'second'),
  (select token from invite_probe where label = 'first'),
  'reissuing produces a different token'
);
select is(
  (select count(*) from public.get_group_invite_preview(
    (select token from invite_probe where label = 'first')
  )),
  0::bigint,
  'reissuing kills the previous link'
);
select is(
  (select name from public.get_group_invite_preview(
    (select token from invite_probe where label = 'second')
  )),
  '29기 수학 탐구',
  'the new link resolves to the group'
);
select ok(
  (select expires_at from public.get_group_invite('20000000-0000-0000-0000-000000000002'))
    between now() + interval '11 hours' and now() + interval '13 hours',
  'the chosen lifetime is measured in hours, not days'
);

select public.revoke_group_invite('20000000-0000-0000-0000-000000000002');

select is(
  (select count(*) from public.get_group_invite('20000000-0000-0000-0000-000000000002')),
  0::bigint,
  'revoking leaves no link behind'
);
select is(
  (select count(*) from public.get_group_invite_preview(
    (select token from invite_probe where label = 'second')
  )),
  0::bigint,
  'a revoked link stops resolving'
);

insert into invite_probe
select 'live', token
from public.issue_group_invite('20000000-0000-0000-0000-000000000002', 336);

-- 교사. 그룹을 검색할 수도 가입 요청을 넣을 수도 없어서 초대가 유일한 가입 경로다.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000099', true);
set local role authenticated;

select is(
  (select name from public.get_group_invite_preview(
    (select token from invite_probe where label = 'live')
  )),
  '29기 수학 탐구',
  'a non-member sees the group behind the link'
);
select is(
  (select already_member from public.get_group_invite_preview(
    (select token from invite_probe where label = 'live')
  )),
  false,
  'the preview knows the teacher has not joined yet'
);
select is(
  (select public.accept_group_invite((select token from invite_probe where label = 'live'))),
  '8f2a1c4e6b9d7a',
  'accepting returns the group address to navigate to'
);
select is(
  (select already_member from public.get_group_invite_preview(
    (select token from invite_probe where label = 'live')
  )),
  true,
  'the preview reflects the new membership'
);

select public.accept_group_invite((select token from invite_probe where label = 'live'));

reset role;

select is(
  (
    select count(*) from public.group_memberships as membership
    join public.profiles as profile on profile.id = membership.profile_id
    where membership.group_id = '20000000-0000-0000-0000-000000000002'
      and profile.pub_id = 'jung-teacher'
  ),
  1::bigint,
  'accepting twice does not create a second membership'
);
select is(
  (
    select membership.role::text from public.group_memberships as membership
    join public.profiles as profile on profile.id = membership.profile_id
    where membership.group_id = '20000000-0000-0000-0000-000000000002'
      and profile.pub_id = 'jung-teacher'
  ),
  'member',
  'a teacher joins as an ordinary member'
);

-- 자기 그룹의 링크를 눌러 본 관리자가 멤버로 강등되면 안 된다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select public.accept_group_invite((select token from invite_probe where label = 'live'));

reset role;

select is(
  (
    select membership.role::text from public.group_memberships as membership
    join public.profiles as profile on profile.id = membership.profile_id
    where membership.group_id = '20000000-0000-0000-0000-000000000002'
      and profile.pub_id = 'hanbyeol-25'
  ),
  'admin',
  'accepting an invite never lowers an existing role'
);

-- 승인제 그룹. 초대로 들어가면 대기 중이던 요청이 유령으로 남으면 안 된다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
set local role authenticated;

insert into invite_probe
select 'film', token
from public.issue_group_invite('20000000-0000-0000-0000-000000000006', 3);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select public.accept_group_invite((select token from invite_probe where label = 'film'));

reset role;

select is(
  (
    select count(*) from public.group_memberships
    where group_id = '20000000-0000-0000-0000-000000000006'
      and profile_id = (
        select id from public.profiles
        where auth_user_id = '10000000-0000-0000-0000-000000000001'
      )
  ),
  1::bigint,
  'an invite skips the approval queue entirely'
);
select is(
  (
    select count(*) from public.group_join_requests
    where group_id = '20000000-0000-0000-0000-000000000006'
      and profile_id = (
        select id from public.profiles
        where auth_user_id = '10000000-0000-0000-0000-000000000001'
      )
  ),
  0::bigint,
  'the pending request is cleared instead of lingering'
);

-- 삭제한 그룹의 링크. 그룹 행은 tombstone으로 남으므로 초대 경로마다 `deleted_at`을 걸러야
-- 하고, 한 군데라도 빠지면 사라진 그룹에 사람이 들어온다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;

insert into invite_probe
select 'doomed', token
from public.issue_group_invite('20000000-0000-0000-0000-000000000005', 1);

select public.delete_group('20000000-0000-0000-0000-000000000005');

select is(
  (select count(*) from public.get_group_invite_preview(
    (select token from invite_probe where label = 'doomed')
  )),
  0::bigint,
  'a deleted group stops honouring its invite link'
);

reset role;

-- 공식 그룹은 승인된 재학생이 자동으로 들어오므로 초대할 사람이 없다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok(
  $$select * from public.issue_group_invite('20000000-0000-0000-0000-000000000001', 1)$$,
  '55000',
  'official groups cannot be invited to',
  'an official group has no invite link'
);
select throws_ok(
  $$select public.accept_group_invite('00000000000000000000000000000000')$$,
  'P0002',
  'invite not found',
  'an unknown token cannot be accepted'
);

-- 기한이 지난 링크
reset role;

-- 발급 시각까지 함께 뒤로 민다. `expires_at > created_at` 제약이 이미 죽은 초대를 만들지
-- 못하게 막고 있어서, 시간을 앞당기는 것이 아니라 통째로 옮겨야 한다.
update private.group_invites
set created_at = now() - interval '2 days',
  expires_at = now() - interval '1 minute'
where group_id = '20000000-0000-0000-0000-000000000002';

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select is(
  (select count(*) from public.get_group_invite_preview(
    (select token from invite_probe where label = 'live')
  )),
  0::bigint,
  'an expired link shows nothing to preview'
);
select throws_ok(
  format(
    $$select public.accept_group_invite(%L)$$,
    (select token from invite_probe where label = 'live')
  ),
  '55000',
  'invite expired',
  'an expired link cannot be accepted'
);
select throws_ok(
  $$select * from private.group_invites$$,
  '42501',
  'permission denied for table group_invites',
  'tokens stay out of reach of the table API'
);

select * from finish();
rollback;
