begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'SELECT'),
  'authenticated has no table-wide profiles SELECT grant'
);
select ok(
  (
    select bool_and(has_column_privilege('authenticated', 'public.profiles', column_name, 'SELECT'))
    from unnest(array[
      'academic_track', 'allow_timeline_posts', 'avatar_path', 'birthday',
      'class_no', 'cohort', 'contact_email', 'cover_path', 'department',
      'description', 'dorm_room', 'gender', 'id', 'is_returning_student',
      'name', 'phone_number', 'pub_id', 'role', 'student_number', 'type'
    ]) as allowed(column_name)
  ),
  'authenticated can select every public profile column'
);
select ok(
  (
    select bool_and(not has_column_privilege('authenticated', 'public.profiles', column_name, 'SELECT'))
    from unnest(array[
      'anonymous_username', 'auth_user_id', 'created_at', 'deleted_at',
      'onboarding_completed_at', 'status', 'status_updated_at',
      'status_updated_by', 'submitted_at', 'updated_at'
    ]) as restricted(column_name)
  ),
  'authenticated cannot select profile administration columns directly'
);
set local role authenticated;
select throws_ok(
  $$select auth_user_id from public.profiles limit 1$$,
  '42501',
  null,
  'direct profile reads cannot request a restricted column'
);
reset role;

select ok(
  not has_sequence_privilege('anon', 'public.profiles_id_seq', 'USAGE')
    and not has_sequence_privilege('anon', 'public.profiles_id_seq', 'SELECT')
    and not has_sequence_privilege('anon', 'public.profiles_id_seq', 'UPDATE'),
  'anonymous users have no profiles sequence privileges'
);
select ok(
  not has_sequence_privilege('authenticated', 'public.profiles_id_seq', 'USAGE')
    and not has_sequence_privilege('authenticated', 'public.profiles_id_seq', 'SELECT')
    and not has_sequence_privilege('authenticated', 'public.profiles_id_seq', 'UPDATE'),
  'authenticated users have no profiles sequence privileges'
);
select ok(
  has_sequence_privilege('service_role', 'public.profiles_id_seq', 'USAGE'),
  'service role can allocate profile IDs'
);
select ok(
  not has_sequence_privilege('service_role', 'public.profiles_id_seq', 'SELECT')
    and not has_sequence_privilege('service_role', 'public.profiles_id_seq', 'UPDATE'),
  'service role has no unnecessary profiles sequence privileges'
);

select ok(
  has_function_privilege('authenticated', 'public.get_my_profile()', 'EXECUTE'),
  'authenticated users can call get_my_profile'
);
select ok(
  not has_function_privilege('anon', 'public.get_my_profile()', 'EXECUTE'),
  'anonymous users cannot call get_my_profile'
);
select ok(
  has_function_privilege('authenticated', 'public.get_accepted_profile(text)', 'EXECUTE'),
  'authenticated users can call get_accepted_profile'
);
select ok(
  not has_function_privilege('anon', 'public.get_accepted_profile(text)', 'EXECUTE'),
  'anonymous users cannot call get_accepted_profile'
);

select set_config(
  'test.expected_profile',
  (
    select to_jsonb(profile)::text
    from public.profiles as profile
    where auth_user_id = '10000000-0000-0000-0000-000000000001'
  ),
  true
);
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select is(
  (select to_jsonb(profile) from public.get_my_profile() as profile),
  current_setting('test.expected_profile')::jsonb,
  'get_my_profile returns the caller complete profile row'
);
select is(
  (select count(*) from public.get_my_profile()),
  1::bigint,
  'get_my_profile returns only the caller profile'
);
select is(
  (select name from public.get_accepted_profile('hanbyeol-25')),
  '이한별',
  'an accepted caller can read another accepted presentation profile'
);

reset role;
update public.profiles
set status = 'blocked'
where auth_user_id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;
select is(
  (select count(*) from public.get_accepted_profile('hanbyeol-25')),
  0::bigint,
  'a non-accepted caller cannot read presentation profiles'
);

select * from finish();
rollback;
