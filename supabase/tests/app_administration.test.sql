begin;

create extension if not exists pgtap with schema extensions;
select plan(38);

select is(
  (select array_agg(enumlabel order by enumsortorder) from pg_enum
   where enumtypid = 'public.profile_status'::regtype),
  array['draft'::name, 'pending'::name, 'accepted'::name, 'blocked'::name, 'withdrawn'::name],
  'profile status has only the clean five-state model'
);
select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'
     and column_name = 'rejection_reason'),
  0::bigint,
  'profiles do not retain a rejection reason'
);
select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
  'clients cannot update application or app-role state directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.profile_permissions', 'INSERT'),
  'clients cannot grant permissions directly'
);
select results_eq(
  $$select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname like 'admin_%'
      and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')$$,
  array[7],
  'authenticated clients can execute all seven admin RPCs'
);
select results_eq(
  $$select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname like 'admin_%'
      and has_function_privilege('anon', procedure.oid, 'EXECUTE')$$,
  array[0],
  'anonymous clients cannot execute admin RPCs'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000', user_id, 'authenticated',
  'authenticated', email, '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values
  ('10000000-0000-0000-0000-000000000002'::uuid, 'pending-admin-test@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000003'::uuid, 'blocked-admin-test@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000004'::uuid, 'member-admin-test@kmla.hs.kr')
) as users(user_id, email);

update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000000002'
where pub_id = 'pending-user';
update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000000003'
where pub_id = 'blocked-user';
update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000000004'
where pub_id = 'hanbyeol-25';

insert into public.profiles (
  pub_id, name, type, student_number, cohort, gender, academic_track,
  birthday, status, submitted_at
)
values
  ('pending-second', '두번째 대기', 'student', '260003', 31, 'female',
   'domestic', '2009-04-01', 'pending', '2026-08-21 00:00:00+00'),
  ('pending-third', '세번째 대기', 'student', '260004', 31, 'male',
   'international', '2009-05-01', 'pending', '2026-08-22 00:00:00+00');

select set_config('test.pending_user_id', (select id::text from public.profiles where pub_id = 'pending-user'), true);
select set_config('test.pending_second_id', (select id::text from public.profiles where pub_id = 'pending-second'), true);
select set_config('test.pending_third_id', (select id::text from public.profiles where pub_id = 'pending-third'), true);
select set_config('test.blocked_user_id', (select id::text from public.profiles where pub_id = 'blocked-user'), true);
select set_config('test.gongang_target_id', (select id::text from public.profiles where pub_id = 'saebyeok-24'), true);
select set_config('test.admin_target_id', (select id::text from public.profiles where pub_id = 'hanbyeol-25'), true);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select throws_ok(
  $$select * from public.admin_list_applications('pending', 50, 0)$$,
  '42501', 'app administrator required',
  'an accepted non-admin cannot read application data'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000098', true);
set local role authenticated;
select is(
  (select pub_id from public.admin_list_applications('pending', 50, 0) limit 1),
  'pending-user',
  'pending applications are listed oldest first'
);
select is(
  (select total_count from public.admin_list_applications('pending', 1, 0)),
  3::bigint,
  'application list returns a screen-scoped total count'
);
select lives_ok(
  $$select * from public.admin_review_applications(
      array[current_setting('test.pending_second_id')::bigint],
      'accepted'
    )$$,
  'an app admin can approve a pending application'
);
reset role;
select is(
  (select status from public.profiles where pub_id = 'pending-second'),
  'accepted'::public.profile_status,
  'approval moves pending to accepted'
);
set local role authenticated;
select lives_ok(
  $$select * from public.admin_review_applications(
      array[current_setting('test.pending_third_id')::bigint],
      'blocked'
    )$$,
  'an app admin can block a pending application'
);
reset role;
select is(
  (select status from public.profiles where pub_id = 'pending-third'),
  'blocked'::public.profile_status,
  'blocking moves pending to blocked'
);
set local role authenticated;
select throws_ok(
  $$select * from public.admin_review_applications(
      array[current_setting('test.pending_user_id')::bigint,
            current_setting('test.pending_user_id')::bigint],
      'accepted'
    )$$,
  '22023', 'application ids must be unique and nonnull',
  'batch review rejects duplicate ids'
);
select throws_ok(
  $$select * from public.admin_review_applications(
      array_fill(current_setting('test.pending_user_id')::bigint, array[201]),
      'accepted'
    )$$,
  '22023', 'between 1 and 200 applications are required',
  'batch review rejects more than 200 applications'
);
select throws_ok(
  $$select * from public.admin_review_applications(
      array[current_setting('test.pending_user_id')::bigint,
            current_setting('test.pending_second_id')::bigint],
      'accepted'
    )$$,
  '55000', 'all applications must be pending',
  'a mixed-state batch is rejected atomically'
);
reset role;
select is(
  (select status from public.profiles where pub_id = 'pending-user'),
  'pending'::public.profile_status,
  'a rejected batch leaves its pending row unchanged'
);
set local role authenticated;

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$select public.submit_my_profile(
      '차단 학생', 'student'::public.profile_type, '260002', null::smallint,
      31::smallint, 'male'::public.profile_gender,
      'international'::public.profile_academic_track, null::text,
      '2009-03-01'::date, null::smallint
    )$$,
  '55000', 'profile cannot be submitted in its current state',
  'a blocked user cannot resubmit'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000098', true);
set local role authenticated;
select lives_ok(
  $$select * from public.admin_unblock_application(
      current_setting('test.blocked_user_id')::bigint
    )$$,
  'an app admin can unblock a blocked application'
);
reset role;
select is(
  (select status from public.profiles where pub_id = 'blocked-user'),
  'draft'::public.profile_status,
  'unblocking moves blocked to draft'
);
set local role authenticated;

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select lives_ok(
  $$select public.submit_my_profile(
      '차단 해제 학생', 'student'::public.profile_type, '260002', null::smallint,
      31::smallint, 'male'::public.profile_gender,
      'international'::public.profile_academic_track, null::text,
      '2009-03-01'::date, null::smallint
    )$$,
  'an unblocked user can edit and resubmit'
);
select is(
  (select status from public.profiles where pub_id = 'blocked-user'),
  'pending'::public.profile_status,
  'resubmission moves draft to pending'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select throws_ok(
  $$select * from public.admin_set_gongang_manager(
      current_setting('test.gongang_target_id')::bigint, true
    )$$,
  '42501', 'app administrator required',
  'a non-admin cannot grant gongang management'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000098', true);
set local role authenticated;
select lives_ok(
  $$select * from public.admin_set_gongang_manager(
      current_setting('test.gongang_target_id')::bigint, true
    )$$,
  'an app admin can grant gongang management'
);
select is(
  (select count(*) from public.admin_list_accepted_users(null, 200, 0, true)),
  1::bigint,
  'the accepted-user API can list only current gongang managers'
);
select ok(
  (select has_gongang_manage from public.admin_list_accepted_users('saebyeok-24', 1, 0)),
  'the gongang permission is persisted'
);
select lives_ok(
  $$select * from public.admin_set_gongang_manager(
      current_setting('test.gongang_target_id')::bigint, false
    )$$,
  'an app admin can revoke gongang management'
);
select ok(
  not (select has_gongang_manage from public.admin_list_accepted_users('saebyeok-24', 1, 0)),
  'the gongang permission is removed'
);
select throws_ok(
  $$select * from public.admin_set_gongang_manager(
      current_setting('test.gongang_target_id')::bigint, null
    )$$,
  '22023', 'enabled must not be null',
  'gongang permission changes reject a null enabled flag'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '10000000-0000-0000-0000-000000000098',
    'amr', jsonb_build_array(jsonb_build_object(
      'method', 'password', 'timestamp', extract(epoch from now() - interval '6 minutes')
    ))
  )::text,
  true
);
select throws_ok(
  $$select * from public.admin_list_members(null, 50, 0)$$,
  '42501', 'recent password authentication required',
  'stale password authentication cannot read the admin screen'
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '10000000-0000-0000-0000-000000000098',
    'amr', jsonb_build_array(jsonb_build_object(
      'method', 'password', 'timestamp', extract(epoch from now())
    ))
  )::text,
  true
);
select lives_ok(
  $$select * from public.admin_list_members(null, 50, 0)$$,
  'recent password authentication permits the admin screen'
);
select lives_ok(
  $$select * from public.admin_set_app_admin(
      current_setting('test.admin_target_id')::bigint, true
    )$$,
  'a recently authenticated admin can grant app admin'
);
select is(
  (select role from public.profiles where pub_id = 'hanbyeol-25'),
  'admin'::public.app_role,
  'the app admin grant is persisted'
);
select lives_ok(
  $$select * from public.admin_set_app_admin(
      (select id from public.profiles where auth_user_id = auth.uid()), false
    )$$,
  'self-demotion is allowed while another app admin remains'
);
select is(
  (select role from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000098'),
  'member'::public.app_role,
  'self-demotion changes the caller to member'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '10000000-0000-0000-0000-000000000004',
    'amr', jsonb_build_array(jsonb_build_object(
      'method', 'password', 'timestamp', extract(epoch from now())
    ))
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select * from public.admin_set_app_admin(
      (select id from public.profiles where auth_user_id = auth.uid()), false
    )$$,
  '55000', 'the final app administrator cannot be demoted',
  'the final app admin cannot self-demote'
);
select throws_ok(
  $$select * from public.admin_set_app_admin(
      (select id from public.profiles where auth_user_id = auth.uid()), null
    )$$,
  '22023', 'enabled must not be null',
  'a null enabled flag cannot bypass final-admin protection'
);
select is(
  (select role from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000004'),
  'admin'::public.app_role,
  'a denied final-admin demotion leaves the role intact'
);

select * from finish();
rollback;
