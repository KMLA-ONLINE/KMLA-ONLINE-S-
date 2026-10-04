begin;

create extension if not exists pgtap with schema extensions;
select plan(56);

insert into public.groups (
  id,
  slug,
  slug_is_custom,
  kind,
  name,
  description,
  join_policy,
  identity_policy,
  posting_policy,
  created_by
)
values (
  '50000000-0000-0000-0000-000000000001',
  '11111111111111',
  false,
  'unofficial',
  '숨은 초대 그룹',
  '',
  'invite_only',
  'optional_anonymous',
  'members',
  (select id from public.profiles where pub_id = 'hanbyeol-25')
);

insert into public.profiles (
  pub_id,
  name,
  type,
  student_number,
  cohort,
  gender,
  academic_track,
  birthday,
  status
)
values (
  'auto-student',
  '자동 가입 학생',
  'student',
  '240098',
  29,
  'female',
  'domestic',
  '2007-01-03',
  'accepted'
);

select is(
  (select member_count from public.groups where slug = '11111111111111'),
  1::bigint,
  'membership trigger maintains the public member count'
);

set local role anon;

select throws_ok(
  $$select * from public.groups$$,
  '42501',
  null,
  'anonymous users have no group table access'
);

select throws_ok(
  $$select private.current_profile_id()$$,
  '42501',
  null,
  'anonymous users cannot execute the private identity helper'
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

-- 승인 가입 그룹(004, 006)은 비공개라, 멤버가 아니면 테이블로 열거되지 않는다(§7.5).
select is(
  (select count(*) from public.groups),
  4::bigint,
  'student sees official, public, and own private groups only'
);

select is(
  (select count(*) from public.groups where join_policy = 'request'),
  0::bigint,
  'non-member cannot enumerate private request groups'
);

select is(
  (select name from public.get_group_link_preview('film-circle')),
  '필름 서클',
  'a non-member with the exact address sees the request group preview'
);

select is(
  (select count(*) from public.get_group_link_preview('8f2a1c4e6b9d7a')),
  0::bigint,
  'the link preview never reveals an invite-only group'
);

select is(
  (select count(*) from public.get_group_link_preview('makers-lab')),
  0::bigint,
  'the link preview is only for private request groups'
);

select is(
  (select count(*) from public.group_memberships),
  3::bigint,
  'student reads only their own memberships'
);

select is(
  (select count(*) from public.groups where slug = '11111111111111'),
  0::bigint,
  'uninvited private group is hidden'
);

select throws_ok(
  $$insert into public.groups (
      slug,
      slug_is_custom,
      kind,
      name,
      join_policy,
      identity_policy,
      posting_policy,
      created_by
    ) values (
      'direct-insert',
      true,
      'unofficial',
      '직접 생성 우회',
      'open',
      'identified',
      'members',
      private.current_profile_id()
    )$$,
  '42501',
  null,
  'groups must be created through the atomic RPC'
);

select throws_ok(
  $$insert into public.group_memberships (group_id, profile_id)
    values (
      '20000000-0000-0000-0000-000000000005',
      (select id from public.profiles
       where pub_id = 'hanbyeol-25')
    )$$,
  '42501',
  null,
  'a caller cannot join a group as another profile'
);

select throws_ok(
  $$insert into public.group_join_requests (group_id, profile_id)
    values (
      '20000000-0000-0000-0000-000000000006',
      (select id from public.profiles
       where pub_id = 'hanbyeol-25')
    )$$,
  '42501',
  null,
  'a caller cannot request membership as another profile'
);

select lives_ok(
  $$insert into public.group_join_requests (group_id, profile_id)
    values (
      '20000000-0000-0000-0000-000000000006',
      private.current_profile_id()
    )$$,
  'student can request a request-policy group'
);

select is(
  (
    select count(*)
    from public.group_join_requests
    where group_id = '20000000-0000-0000-0000-000000000006'
  ),
  1::bigint,
  'student reads their own join request'
);

select isnt(
  (select requested_at from public.get_group_link_preview('film-circle')),
  null,
  'the link preview reports the pending request'
);

select lives_ok(
  $$delete from public.group_join_requests
    where group_id = '20000000-0000-0000-0000-000000000006'
      and profile_id = private.current_profile_id()$$,
  'student can cancel their own request'
);

select throws_ok(
  $$insert into public.group_join_requests (group_id, profile_id)
    values (
      '20000000-0000-0000-0000-000000000003',
      private.current_profile_id()
    )$$,
  '55000',
  'group does not accept join requests',
  'a public group does not take join requests'
);

select throws_ok(
  $$insert into public.group_join_requests (group_id, profile_id)
    values (
      '50000000-0000-0000-0000-000000000001',
      private.current_profile_id()
    )$$,
  '55000',
  'group does not accept join requests',
  'an invite-only group does not take join requests'
);

select lives_ok(
  $$insert into public.group_memberships (group_id, profile_id)
    values (
      '20000000-0000-0000-0000-000000000003',
      private.current_profile_id()
    )$$,
  'student can join an open group directly'
);

select is(
  (select member_count from public.groups where slug = 'makers-lab'),
  5::bigint,
  'joining updates the member count'
);

reset role;

select ok(
  not has_table_privilege('anon', 'public.groups', 'SELECT'),
  'anonymous has no groups select grant'
);

select ok(
  not has_table_privilege('authenticated', 'public.groups', 'DELETE'),
  'authenticated users cannot delete groups directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.groups', 'INSERT'),
  'authenticated users cannot insert groups directly'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'public.group_memberships',
    'role',
    'UPDATE'
  ),
  'authenticated users cannot update membership roles'
);

select ok(
  not has_function_privilege('anon', 'private.current_profile_id()', 'EXECUTE'),
  'anonymous has no identity helper execute grant'
);

delete from public.group_memberships
where group_id = '20000000-0000-0000-0000-000000000003'
  and profile_id = (
    select id
    from public.profiles
    where auth_user_id = '10000000-0000-0000-0000-000000000001'
  );

select is(
  (select member_count from public.groups where slug = 'makers-lab'),
  4::bigint,
  'leaving decrements the member count'
);

insert into public.group_memberships (group_id, profile_id)
values (
  '20000000-0000-0000-0000-000000000003',
  (
    select id
    from public.profiles
    where auth_user_id = '10000000-0000-0000-0000-000000000001'
  )
);
set local role authenticated;

select lives_ok(
  $$update public.group_memberships
    set pinned_at = now()
    where group_id = '20000000-0000-0000-0000-000000000003'
      and profile_id = private.current_profile_id()$$,
  'student can pin their own membership'
);

select throws_ok(
  $$update public.group_memberships
    set role = 'admin'
    where group_id = '20000000-0000-0000-0000-000000000003'$$,
  '42501',
  null,
  'column grants prevent self-promotion'
);

select throws_ok(
  $$select * from public.create_group(
    'official',
    '권한 없는 공식 그룹',
    '',
    'unauth-official',
    'open',
    'identified',
    'staff'
  )$$,
  '42501',
  'official group creation is not allowed',
  'non-admin cannot create an official group'
);

reset role;
update public.profiles
set role = 'admin'
where auth_user_id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;

select lives_ok(
  $$select * from public.create_group(
    'official',
    'DB 공식 그룹',
    '',
    'db-official',
    'open',
    'identified',
    'staff',
    true
  )$$,
  'student app admin can create an official group'
);

select is(
  (select hide_staff_roles from public.groups where slug = 'db-official'),
  true,
  'group creation stores the requested staff-role visibility'
);

select throws_ok(
  $$select * from public.create_group(
    'official', 'DB 승인 공식 그룹', '', null, 'request', 'identified', 'staff'
  )$$,
  '22023',
  'official groups must be open',
  'an official group cannot use a private policy'
);

select throws_ok(
  $$select * from public.create_group(
    'unofficial', 'DB 주소 승인 그룹', '', 'db-request', 'request',
    'optional_anonymous', 'members'
  )$$,
  '22023',
  'private groups cannot use a custom slug',
  'a private request group cannot take a custom slug'
);

select lives_ok(
  $$select * from public.create_group(
    'unofficial', 'DB 승인 그룹', '', null, 'request',
    'optional_anonymous', 'members'
  )$$,
  'a private request group gets a generated slug'
);

select lives_ok(
  $$select * from public.update_group_settings(
    (select id from public.groups where name = 'DB 승인 그룹'),
    'DB 승인 그룹', '', 'invite_only', 'optional_anonymous', 'members', false
  )$$,
  'a request group can become invite-only'
);

select lives_ok(
  $$select * from public.update_group_settings(
    (select id from public.groups where name = 'DB 승인 그룹'),
    'DB 승인 그룹', '', 'request', 'optional_anonymous', 'members', false
  )$$,
  'an invite-only group can become a request group'
);

select lives_ok(
  $$select * from public.update_group_settings(
    (select id from public.groups where name = 'DB 승인 그룹'),
    'DB 승인 그룹', '', 'open', 'optional_anonymous', 'members', false
  )$$,
  'a private request group can become public'
);

select throws_ok(
  $$select * from public.update_group_settings(
    (select id from public.groups where name = 'DB 승인 그룹'),
    'DB 승인 그룹', '', 'request', 'optional_anonymous', 'members', false
  )$$,
  '55000',
  'public groups cannot become private',
  'a public group cannot go back to approval joining'
);

select is(
  (select member_count from public.groups where slug = 'db-official'),
  3::bigint,
  'new official group enrolls all accepted students'
);

reset role;
insert into public.profiles (
  pub_id,
  name,
  type,
  student_number,
  cohort,
  gender,
  academic_track,
  birthday,
  status
)
values (
  'pending-student',
  '승인 대기 학생',
  'student',
  '240097',
  29,
  'male',
  'international',
  '2007-01-04',
  'pending'
);

update public.profiles
set status = 'accepted'
where pub_id = 'pending-student';

select is(
  (select member_count from public.groups where slug = 'db-official'),
  4::bigint,
  'newly accepted student joins existing official groups'
);

update public.profiles
set type = 'alumni'
where pub_id = 'pending-student';

select is(
  (select member_count from public.groups where slug = 'db-official'),
  4::bigint,
  'a graduating student keeps existing official memberships'
);

update public.profiles
set
  type = 'teacher',
  student_number = null,
  cohort = null,
  gender = null,
  academic_track = null,
  birthday = null
where pub_id = 'pending-student';

select is(
  (select member_count from public.groups where slug = 'db-official'),
  3::bigint,
  'a teacher transition removes official memberships'
);

update public.profiles
set
  type = 'student',
  student_number = '240097',
  cohort = 29,
  gender = 'male',
  academic_track = 'international',
  birthday = '2007-01-04'
where pub_id = 'pending-student';

select is(
  (select member_count from public.groups where slug = 'db-official'),
  4::bigint,
  'restoring student eligibility restores official memberships'
);

update public.profiles
set status = 'withdrawn'
where pub_id = 'pending-student';

select is(
  (select member_count from public.groups where slug = 'db-official'),
  3::bigint,
  'losing accepted status removes official memberships'
);

update public.profiles
set status = 'accepted'
where pub_id = 'pending-student';

select is(
  (select member_count from public.groups where slug = 'db-official'),
  4::bigint,
  'restoring accepted status restores official memberships'
);

update public.profiles
set deleted_at = now()
where pub_id = 'pending-student';

select is(
  (select member_count from public.groups where slug = 'db-official'),
  3::bigint,
  'deleting a profile removes official memberships'
);

select private.recount_group_members(
  (select id from public.groups where slug = 'db-official')
);

select is(
  (select member_count from public.groups where slug = 'db-official'),
  (
    select count(*)
    from public.group_memberships
    where group_id = (select id from public.groups where slug = 'db-official')
  ),
  'member count can be rebuilt from normalized memberships'
);

select throws_ok(
  $$update public.profiles
    set
      type = 'teacher',
      student_number = null,
      cohort = null,
      gender = null,
      academic_track = null,
      birthday = null
    where auth_user_id = '10000000-0000-0000-0000-000000000001'$$,
  '23514',
  'official group owner must transfer ownership before losing eligibility',
  'an official owner must transfer ownership before becoming ineligible'
);

update public.group_memberships
set role = 'member'
where group_id = (select id from public.groups where slug = 'db-official')
  and profile_id = (
    select id from public.profiles
    where auth_user_id = '10000000-0000-0000-0000-000000000001'
  );

update public.group_memberships
set role = 'owner'
where group_id = (select id from public.groups where slug = 'db-official')
  and profile_id = (
    select id from public.profiles
    where pub_id = 'auto-student'
  );

update public.profiles
set
  type = 'teacher',
  student_number = null,
  cohort = null,
  gender = null,
  academic_track = null,
  birthday = null,
  role = 'admin'
where auth_user_id = '10000000-0000-0000-0000-000000000001';

set local role authenticated;

select is(
  (select count(*) from public.groups),
  -- 위에서 만든 'DB 승인 그룹'이 공개로 바뀌어 소유자로 남아 있다.
  6::bigint,
  'teacher app admin sees official groups and joined unofficial groups'
);

select is(
  (select count(*) from public.groups where kind = 'official'),
  2::bigint,
  'teacher app admin can see official groups'
);

select throws_ok(
  $$select * from public.discover_groups(
    p_query => '',
    p_include_joined => false,
    p_limit => 24
  )$$,
  '42501',
  'group discovery is not allowed',
  'teacher cannot discover groups'
);

select throws_ok(
  $$insert into public.group_memberships (group_id, profile_id)
    values (
      '20000000-0000-0000-0000-000000000005',
      private.current_profile_id()
    )$$,
  '42501',
  null,
  'teacher cannot directly join an open group'
);

select throws_ok(
  $$insert into public.group_join_requests (group_id, profile_id)
    values (
      '20000000-0000-0000-0000-000000000006',
      private.current_profile_id()
    )$$,
  '42501',
  null,
  'teacher cannot request a private request group'
);

select is(
  (select name from public.get_group_link_preview('film-circle')),
  '필름 서클',
  'teacher with the address sees the preview without a way to request'
);

select throws_ok(
  $$select * from public.create_group(
    'official',
    '교사 공식 그룹',
    '',
    't-official',
    'open',
    'identified',
    'staff'
  )$$,
  '42501',
  'official group creation is not allowed',
  'teacher app admin cannot create an official group'
);

select * from finish();
rollback;
