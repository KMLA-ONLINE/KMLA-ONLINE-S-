begin;

create extension if not exists pgtap with schema extensions;
select plan(65);

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
  ('10000000-0000-0000-0000-000000000002'::uuid, 'group-owner@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000003'::uuid, 'anonymous-owner@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000004'::uuid, 'group-member@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000005'::uuid, 'request-owner@kmla.hs.kr')
) as users(user_id, email);

update public.profiles
set auth_user_id = case pub_id
  when 'kim-admin' then '10000000-0000-0000-0000-000000000002'::uuid
  when 'hanbyeol-25' then '10000000-0000-0000-0000-000000000003'::uuid
  when 'saebyeok-24' then '10000000-0000-0000-0000-000000000004'::uuid
  when 'pureum-23' then '10000000-0000-0000-0000-000000000005'::uuid
end,
avatar_path = 'avatars/' || pub_id || '.webp'
where pub_id in (
  'kim-admin',
  'hanbyeol-25',
  'saebyeok-24',
  'pureum-23'
);

insert into private.web_push_subscriptions (
  profile_id, endpoint, p256dh, auth, created_at
) values (
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001'),
  'https://push.example.test/group-join-result',
  'BNcRdreALRFXTkA0bP8M5bq6fP6w6uLqFhKxqv2QdA',
  'dGVzdC1hdXRoLWtleQ',
  now() - interval '1 hour'
);

update public.group_memberships as membership
set role = case profile.pub_id
  when 'hanbyeol-25' then 'admin'::public.group_member_role
  when 'saebyeok-24' then 'manager'::public.group_member_role
  else membership.role
end,
joined_at = case profile.pub_id
  when 'kim-admin' then '2026-01-01 00:00:00+00'::timestamptz
  when 'hanbyeol-25' then '2026-01-02 00:00:00+00'::timestamptz
  when 'saebyeok-24' then '2026-01-03 00:00:00+00'::timestamptz
  else '2026-01-04 00:00:00+00'::timestamptz
end
from public.profiles as profile
where membership.profile_id = profile.id
  and membership.group_id = '20000000-0000-0000-0000-000000000003';

insert into public.group_join_requests (group_id, profile_id, requested_at)
values (
  '20000000-0000-0000-0000-000000000006',
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001'),
  '2026-02-01 00:00:00+00'
);

select ok(
  not has_table_privilege('authenticated', 'public.group_memberships', 'UPDATE'),
  'membership roles cannot be updated directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.groups', 'UPDATE'),
  'group settings cannot be updated directly'
);
select ok(
  not has_function_privilege('anon', 'public.list_group_members(uuid,text,public.group_member_role,timestamptz,uuid,integer)', 'EXECUTE'),
  'anonymous users cannot execute roster RPCs'
);
select ok(
  has_function_privilege('authenticated', 'public.update_group_settings(uuid,text,text,public.group_join_policy,public.group_identity_policy,public.group_posting_policy)', 'EXECUTE'),
  'settings RPC is explicitly granted to authenticated users'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;

select throws_ok(
  $$select * from public.list_group_members(
    '20000000-0000-0000-0000-000000000003', '', null, null, null, 0
  )$$,
  '22023',
  'member page limit must be between 1 and 100',
  'roster rejects invalid page sizes'
);
select is(
  (select count(*) from public.list_group_members(
    '20000000-0000-0000-0000-000000000003', '', null, null, null, 2
  )),
  2::bigint,
  'roster limits the first page'
);
select is(
  (
    with first_page as (
      select * from public.list_group_members(
        '20000000-0000-0000-0000-000000000003', '', null, null, null, 2
      )
    ), cursor_row as (
        select * from first_page order by role desc, joined_at desc, membership_id desc limit 1
      )
      select count(*) from cursor_row,
      lateral public.list_group_members(
        '20000000-0000-0000-0000-000000000003', '', cursor_row.role,
        cursor_row.joined_at, cursor_row.membership_id, 30
      )
  ),
  2::bigint,
  'roster cursor continues after the final first-page row without duplicates'
);

select is(
  (
    select array_agg(role order by role, joined_at, membership_id)
    from public.list_group_members('20000000-0000-0000-0000-000000000003')
  ),
  array['owner', 'admin', 'manager', 'member']::public.group_member_role[],
  'roster sorts owner, admin, manager, then member'
);
select is(
  (
    select name
    from public.list_group_members('20000000-0000-0000-0000-000000000003', '이한별')
  ),
  '이한별',
  'identified roster searches names'
);
select is(
  (
    select count(*)
    from public.list_group_members('20000000-0000-0000-0000-000000000003', '25')
  ),
  1::bigint,
  'identified roster searches cohorts'
);
select is(
  (
    select count(*)
    from public.list_group_members('20000000-0000-0000-0000-000000000004', '박새벽')
  ),
  1::bigint,
  'optional-anonymous roster searches names'
);
select is(
  (
    select count(*)
    from public.list_group_members('20000000-0000-0000-0000-000000000004', '24')
  ),
  1::bigint,
  'optional-anonymous roster searches cohorts'
);
select ok(
  exists (
    select 1
    from public.list_group_members('20000000-0000-0000-0000-000000000004')
    where pub_id = 'saebyeok-24' and name = '박새벽' and avatar_path is not null
  ),
  'optional-anonymous roster exposes normal profile presentation fields'
);
select throws_ok(
  $$select * from public.list_group_join_requests('20000000-0000-0000-0000-000000000004')$$,
  '42501',
  'group administrator required',
  'ordinary members cannot list join requests'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
set local role authenticated;

select is(
  (
    select name
    from public.list_group_join_requests('20000000-0000-0000-0000-000000000006')
  ),
  '홍길동',
  'identified join requests expose the safe profile presentation'
);
select lives_ok(
  $$select public.approve_group_join_request(
    '20000000-0000-0000-0000-000000000006',
    (select request_id from public.list_group_join_requests('20000000-0000-0000-0000-000000000006'))
  )$$,
  'owner can approve a join request'
);
select is(
  (select count(*) from public.list_group_join_requests('20000000-0000-0000-0000-000000000006')),
  0::bigint,
  'approval consumes the request'
);
select is(
  (
    select role
    from public.list_group_members('20000000-0000-0000-0000-000000000006')
    where name = '홍길동'
  ),
  'member'::public.group_member_role,
  'approval inserts a member role atomically'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select ok(
  (
    select request_id is not null
      and pub_id is not null
      and name = '홍길동'
      and cohort = 29
    from public.list_group_join_requests('20000000-0000-0000-0000-000000000004')
  ),
  'join request moderation exposes normal profile presentation fields'
);
select throws_ok(
  $$select * from public.update_group_settings(
    '20000000-0000-0000-0000-000000000004',
    '기숙사 이야기', '', 'open', 'optional_anonymous', 'members'
  )$$,
  '55000',
  'pending join requests must be resolved first',
  'pending requests block moving away from request policy'
);
select lives_ok(
  $$select public.reject_group_join_request(
    '20000000-0000-0000-0000-000000000004',
    (select request_id from public.list_group_join_requests('20000000-0000-0000-0000-000000000004'))
  )$$,
  'owner can reject a join request'
);
select is(
  (select count(*) from public.list_group_join_requests('20000000-0000-0000-0000-000000000004')),
  0::bigint,
  'rejection consumes the request'
);
reset role;
select is(
  (
    select count(*)
    from public.notifications
    where kind = 'group_join_rejected'
      and recipient_profile_id = (
        select id from public.profiles
        where auth_user_id = '10000000-0000-0000-0000-000000000001'
      )
  ),
  1::bigint,
  'rejection creates an in-app notification for the requester'
);
set local role service_role;
select is(
  (
    select count(*)
    from public.claim_notification_deliveries(200, 60)
    where title = '그룹 가입 요청이 거절되었습니다.'
  ),
  1::bigint,
  'rejection Push remains deliverable when the requester is not a group member'
);
set local role authenticated;
select lives_ok(
  $$select * from public.update_group_settings(
    '20000000-0000-0000-0000-000000000004',
    '새 기숙사 이야기', '새 설명', 'open', 'optional_anonymous', 'staff'
  )$$,
  'settings can change after requests are resolved'
);
select is(
  (select slug from public.groups where id = '20000000-0000-0000-0000-000000000004'),
  'dorm-stories',
  'settings keep the slug immutable'
);
select is(
  (select kind from public.groups where id = '20000000-0000-0000-0000-000000000004'),
  'unofficial'::public.group_kind,
  'settings keep the kind immutable'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select lives_ok(
  $$select public.update_group_member_role(
    '20000000-0000-0000-0000-000000000003',
    (select membership_id from public.list_group_members('20000000-0000-0000-0000-000000000003')
      where pub_id = 'pureum-23'),
    'manager'
  )$$,
  'owner can change a non-owner role'
);
select throws_ok(
  $$select public.update_group_member_role(
    '20000000-0000-0000-0000-000000000003',
    (select membership_id from public.list_group_members('20000000-0000-0000-0000-000000000003')
      where pub_id = 'pureum-23'),
    'owner'
  )$$,
  '42501',
  'role change is not allowed',
  'ordinary role API cannot assign owner'
);
select throws_ok(
  $$select public.update_group_member_role(
    '20000000-0000-0000-0000-000000000003',
    (select membership_id from public.list_group_members('20000000-0000-0000-0000-000000000003')
      where role = 'owner'),
    'member'
  )$$,
  '42501',
  'role change is not allowed',
  'ordinary role API cannot demote the owner'
);
select throws_ok(
  $$select public.transfer_group_ownership(
    '20000000-0000-0000-0000-000000000003',
    (select membership_id from public.list_group_members('20000000-0000-0000-0000-000000000003')
      where pub_id = 'saebyeok-24')
  )$$,
  '42501',
  'ownership can only be transferred to an administrator',
  'ownership transfer requires an existing administrator'
);
select lives_ok(
  $$select public.transfer_group_ownership(
    '20000000-0000-0000-0000-000000000003',
    (select membership_id from public.list_group_members('20000000-0000-0000-0000-000000000003')
      where pub_id = 'hanbyeol-25')
  )$$,
  'owner can transfer ownership to an administrator'
);
select is(
  (
    select role
    from public.group_memberships
    where group_id = '20000000-0000-0000-0000-000000000003'
      and profile_id = private.current_profile_id()
  ),
  'admin'::public.group_member_role,
  'ownership transfer demotes the old owner to admin'
);
select is(
  (
    select role
    from public.list_group_members('20000000-0000-0000-0000-000000000003')
    where pub_id = 'hanbyeol-25'
  ),
  'owner'::public.group_member_role,
  'ownership transfer promotes the target to owner'
);
select is(
  (
    select count(*)
    from public.list_group_members('20000000-0000-0000-0000-000000000003')
    where role = 'owner'
  ),
  1::bigint,
  'ownership transfer preserves exactly one owner'
);

select lives_ok(
  $$select * from public.update_group_settings(
    '20000000-0000-0000-0000-000000000003',
    '메이커스 랩', '실명 전용 전환', 'open', 'identified', 'members'
  )$$,
  'admin can change group settings'
);
select throws_ok(
  $$select * from public.update_group_settings(
    '20000000-0000-0000-0000-000000000003',
    '메이커스 랩', '비공개 복귀', 'invite_only', 'identified', 'members'
  )$$,
  '55000',
  'public groups cannot become private',
  'public groups cannot become private again'
);
select lives_ok(
  $$select * from public.update_group_settings(
    '20000000-0000-0000-0000-000000000001',
    '학교 공지', '기본 정보 변경', 'open', 'identified', 'staff'
  )$$,
  'an official group admin can save its settings'
);
-- 공식 그룹이라는 이유만으로 정책을 잠그지는 않는다. 남는 제약은 그룹의 현재 상태에서 나온다.
select lives_ok(
  $$select * from public.update_group_settings(
    '20000000-0000-0000-0000-000000000001',
    '학교 공지', '정책 변경', 'request', 'identified', 'staff'
  )$$,
  'official group policies can change too'
);
select is(
  (select join_policy from public.groups where id = '20000000-0000-0000-0000-000000000001'),
  'request'::public.group_join_policy,
  'the official group keeps its new join policy'
);

-- 정책은 바꿀 수 있어도 그룹 자체를 없앨 수는 없다. 승인된 재학생이 자동으로 가입하는 공간이
-- 일반 그룹 운영 권한으로 사라지면 안 된다.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select throws_ok(
  $$select public.delete_group('20000000-0000-0000-0000-000000000001')$$,
  '42501', 'app administrator required',
  'a non-admin cannot delete an official group'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select lives_ok(
  $$select * from public.update_group_settings(
    '20000000-0000-0000-0000-000000000001',
    '학교 공지', '선택 익명 전환', 'request', 'optional_anonymous', 'staff'
  )$$,
  'an official group can enable optional anonymity'
);
select is(
  (select identity_policy from public.groups where id = '20000000-0000-0000-0000-000000000001'),
  'optional_anonymous'::public.group_identity_policy,
  'the official group keeps its optional-anonymous policy'
);

select lives_ok(
  $$select * from public.update_group_settings(
    '20000000-0000-0000-0000-000000000003',
    '메이커스 랩', '선택 익명 복귀', 'open', 'optional_anonymous', 'members'
  )$$,
  'identity policy can change back to optional-anonymous'
);
select is(
  (
    select array_agg(enumlabel::text order by enumsortorder)
    from pg_catalog.pg_enum
    where enumtypid = 'public.group_identity_policy'::regtype
  ),
  array['identified', 'optional_anonymous']::text[],
  'group identity policy only exposes supported values'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;

select throws_ok(
  $$select * from public.update_group_settings(
    '20000000-0000-0000-0000-000000000003',
    '권한 없음', '', 'open', 'identified', 'members'
  )$$,
  '42501',
  'group administrator required',
  'manager cannot update group settings'
);
select throws_ok(
  $$select public.reject_group_join_request(
    '20000000-0000-0000-0000-000000000004',
    gen_random_uuid()
  )$$,
  '42501',
  'group administrator required',
  'non-admin cannot moderate requests'
);

-- 주말 산책단(`...0005`)의 시드 구성: 새벽=소유자(auth4), 시드 학생=관리자(auth1),
-- 푸름=관리자(auth5), 한별=멤버(auth3). 관리자 자리에서 무엇을 할 수 있고 없는지를 본다.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select throws_ok(
  $$select public.update_group_member_role(
    '20000000-0000-0000-0000-000000000005',
    (select membership_id from public.list_group_members('20000000-0000-0000-0000-000000000005')
      where pub_id = 'pureum-23'),
    'member'
  )$$,
  '42501', 'role change is not allowed', 'a plain member cannot change roles'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select public.update_group_member_role(
    '20000000-0000-0000-0000-000000000005',
    (select membership_id from public.list_group_members('20000000-0000-0000-0000-000000000005')
      where pub_id = 'hanbyeol-25'),
    'manager'
  )$$,
  'an administrator can appoint a manager'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select throws_ok(
  $$select public.update_group_member_role(
    '20000000-0000-0000-0000-000000000005',
    (select membership_id from public.list_group_members('20000000-0000-0000-0000-000000000005')
      where pub_id = 'pureum-23'),
    'member'
  )$$,
  '42501', 'role change is not allowed', 'a manager cannot change roles either'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

-- 관리자를 세우는 것도 소유자만 한다. 늘리는 것은 아무나, 줄이는 것은 소유자만 할 수 있으면
-- 관리자 수가 한 방향으로만 늘어난다.
select throws_ok(
  $$select public.update_group_member_role(
    '20000000-0000-0000-0000-000000000005',
    (select membership_id from public.list_group_members('20000000-0000-0000-0000-000000000005')
      where pub_id = 'hanbyeol-25'),
    'admin'
  )$$,
  '42501', 'only the owner can appoint an administrator',
  'an administrator cannot appoint another administrator'
);

-- 이미 관리자인 사람은 소유자만 건드린다.
select throws_ok(
  $$select public.update_group_member_role(
    '20000000-0000-0000-0000-000000000005',
    (select membership_id from public.list_group_members('20000000-0000-0000-0000-000000000005')
      where pub_id = 'pureum-23'),
    'manager'
  )$$,
  '42501', 'only the owner can change an administrator',
  'an administrator cannot demote another administrator'
);
select throws_ok(
  $$select public.delete_group('20000000-0000-0000-0000-000000000005')$$,
  '42501', 'group owner required', 'an administrator cannot delete the group'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;

select lives_ok(
  $$select public.update_group_member_role(
    '20000000-0000-0000-0000-000000000005',
    (select membership_id from public.list_group_members('20000000-0000-0000-0000-000000000005')
      where pub_id = 'pureum-23'),
    'member'
  )$$,
  'the owner can demote an administrator'
);
select lives_ok(
  $$select public.update_group_member_role(
    '20000000-0000-0000-0000-000000000005',
    (select membership_id from public.list_group_members('20000000-0000-0000-0000-000000000005')
      where pub_id = 'hanbyeol-25'),
    'admin'
  )$$,
  'the owner can appoint an administrator'
);

select lives_ok(
  $$select public.delete_group('20000000-0000-0000-0000-000000000005')$$,
  'the owner can delete the group'
);
select is(
  (select count(*) from public.groups where id = '20000000-0000-0000-0000-000000000005'),
  0::bigint,
  'a deleted group leaves every members view'
);
select throws_ok(
  $$select public.delete_group('20000000-0000-0000-0000-000000000005')$$,
  'P0002', 'group not found', 'a deleted group cannot be deleted twice'
);

reset role;

select is(
  (
    select count(*) from public.group_memberships
    where group_id = '20000000-0000-0000-0000-000000000005'
  ),
  0::bigint,
  'deleting a group drops every membership'
);
select ok(
  (
    select deleted_at is not null from public.groups
    where id = '20000000-0000-0000-0000-000000000005'
  ),
  'the group row survives as a tombstone so storage cleanup still has its targets'
);

reset role;
insert into public.groups (
  id, slug, slug_is_custom, kind, name, description, join_policy,
  identity_policy, posting_policy, created_by
)
values (
  '50000000-0000-0000-0000-000000000006',
  'teacher-admin',
  true,
  'official',
  '교사 관리자 삭제 그룹',
  '',
  'open',
  'identified',
  'staff',
  (select id from public.profiles where pub_id = 'kim-admin')
);
update public.profiles
set role = 'admin',
  type = 'teacher',
  cohort = null,
  gender = null,
  academic_track = null
where auth_user_id = '10000000-0000-0000-0000-000000000005';
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select is(
  (select count(*) from public.groups where id = '50000000-0000-0000-0000-000000000006'),
  1::bigint,
  'a teacher app admin can read an official group without membership'
);
select is(
  (
    select count(*)
    from public.group_memberships
    where group_id = '50000000-0000-0000-0000-000000000006'
      and profile_id = private.current_profile_id()
  ),
  0::bigint,
  'the teacher app admin is not a member of the official group'
);
select lives_ok(
  $$select public.delete_group('50000000-0000-0000-0000-000000000006')$$,
  'a non-owner teacher app admin can delete an official group'
);
reset role;
select is(
  (select count(*) from public.group_memberships where group_id = '50000000-0000-0000-0000-000000000006'),
  0::bigint,
  'admin deletion removes every official-group membership'
);
select ok(
  (
    select deleted_at is not null from public.groups
    where id = '50000000-0000-0000-0000-000000000006'
  ),
  'admin deletion leaves the official group as a storage-cleanup tombstone'
);

select * from finish();
rollback;
