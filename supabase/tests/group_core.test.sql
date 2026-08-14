begin;

create extension if not exists pgtap with schema extensions;
select plan(39);

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
  'g-11111111111111111111',
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
  (select member_count from public.groups where slug = 'g-11111111111111111111'),
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

select is(
  (select count(*) from public.groups),
  6::bigint,
  'student sees official, public, and own private groups only'
);

select is(
  (select count(*) from public.group_memberships),
  2::bigint,
  'student reads only their own memberships'
);

select is(
  (select count(*) from public.groups where slug = 'g-11111111111111111111'),
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
      'direct-insert-check',
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

select lives_ok(
  $$delete from public.group_join_requests
    where group_id = '20000000-0000-0000-0000-000000000006'
      and profile_id = private.current_profile_id()$$,
  'student can cancel their own request'
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
    'unauthorized-official',
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
    'db-official-check',
    'open',
    'identified',
    'staff'
  )$$,
  'student app admin can create an official group'
);

select is(
  (select member_count from public.groups where slug = 'db-official-check'),
  2::bigint,
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
  (select member_count from public.groups where slug = 'db-official-check'),
  3::bigint,
  'newly accepted student joins existing official groups'
);

update public.profiles
set type = 'alumni'
where pub_id = 'pending-student';

select is(
  (select member_count from public.groups where slug = 'db-official-check'),
  3::bigint,
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
  (select member_count from public.groups where slug = 'db-official-check'),
  2::bigint,
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
  (select member_count from public.groups where slug = 'db-official-check'),
  3::bigint,
  'restoring student eligibility restores official memberships'
);

update public.profiles
set status = 'withdrawn'
where pub_id = 'pending-student';

select is(
  (select member_count from public.groups where slug = 'db-official-check'),
  2::bigint,
  'losing accepted status removes official memberships'
);

update public.profiles
set status = 'accepted'
where pub_id = 'pending-student';

select is(
  (select member_count from public.groups where slug = 'db-official-check'),
  3::bigint,
  'restoring accepted status restores official memberships'
);

update public.profiles
set deleted_at = now()
where pub_id = 'pending-student';

select is(
  (select member_count from public.groups where slug = 'db-official-check'),
  2::bigint,
  'deleting a profile removes official memberships'
);

select private.recount_group_members(
  (select id from public.groups where slug = 'db-official-check')
);

select is(
  (select member_count from public.groups where slug = 'db-official-check'),
  (
    select count(*)
    from public.group_memberships
    where group_id = (select id from public.groups where slug = 'db-official-check')
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
where group_id = (select id from public.groups where slug = 'db-official-check')
  and profile_id = (
    select id from public.profiles
    where auth_user_id = '10000000-0000-0000-0000-000000000001'
  );

update public.group_memberships
set role = 'owner'
where group_id = (select id from public.groups where slug = 'db-official-check')
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
  2::bigint,
  'teacher sees only joined unofficial groups'
);

select is(
  (select count(*) from public.groups where kind = 'official'),
  0::bigint,
  'teacher cannot see official groups'
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
  $$select * from public.create_group(
    'official',
    '교사 공식 그룹',
    '',
    'teacher-official',
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
