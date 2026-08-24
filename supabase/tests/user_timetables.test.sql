begin;

create extension if not exists pgtap with schema extensions;
select plan(39);

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
  ('10000000-0000-0000-0000-000000000003'::uuid, 'timetable-user-a@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000004'::uuid, 'timetable-user-b@kmla.hs.kr')
) as users(user_id, email);

update public.profiles
set auth_user_id = case pub_id
  when 'hanbyeol-25' then '10000000-0000-0000-0000-000000000003'::uuid
  when 'saebyeok-24' then '10000000-0000-0000-0000-000000000004'::uuid
end
where pub_id in ('hanbyeol-25', 'saebyeok-24');

select set_config(
  'test.timetable_profile_a',
  (select id::text from public.profiles where pub_id = 'hanbyeol-25'),
  true
);
select set_config(
  'test.timetable_profile_b',
  (select id::text from public.profiles where pub_id = 'saebyeok-24'),
  true
);

delete from public.user_timetables
where profile_id in (
  current_setting('test.timetable_profile_a')::bigint,
  current_setting('test.timetable_profile_b')::bigint
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.user_timetables'::regclass),
  'user timetables have RLS enabled'
);
select ok(
  has_table_privilege('authenticated', 'public.user_timetables', 'SELECT'),
  'authenticated clients can select timetables'
);
select ok(
  has_table_privilege('authenticated', 'public.user_timetables', 'INSERT'),
  'authenticated clients can insert timetables'
);
select ok(
  has_table_privilege('authenticated', 'public.user_timetables', 'UPDATE'),
  'authenticated clients can update timetables'
);
select ok(
  not has_table_privilege('authenticated', 'public.user_timetables', 'DELETE'),
  'authenticated clients cannot delete timetables'
);
select ok(
  not has_table_privilege('anon', 'public.user_timetables', 'SELECT'),
  'anonymous clients cannot read timetables'
);
select ok(
  has_function_privilege('authenticated', 'private.is_valid_timetable_semesters(jsonb)', 'EXECUTE'),
  'authenticated clients can evaluate the timetable check'
);
select ok(
  not has_function_privilege('anon', 'private.is_valid_timetable_semesters(jsonb)', 'EXECUTE'),
  'anonymous clients cannot execute the timetable validator'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id, semesters)
      values (%s, '[]'::jsonb)$sql$,
    current_setting('test.timetable_profile_a')
  ),
  '23514', null,
  'the semesters value must be an object'
);
select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id, semesters)
      values (%s, '{"1-1":[],"1-2":[],"2-1":[],"2-2":[],"3-1":[]}'::jsonb)$sql$,
    current_setting('test.timetable_profile_a')
  ),
  '23514', null,
  'all six semester keys are required'
);
select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id, semesters)
      values (%s, '{"1-1":{},"1-2":[],"2-1":[],"2-2":[],"3-1":[],"3-2":[]}'::jsonb)$sql$,
    current_setting('test.timetable_profile_a')
  ),
  '23514', null,
  'every required semester must contain an array'
);
select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id, semesters)
      values (%s, '{"1-1":["course"],"1-2":[],"2-1":[],"2-2":[],"3-1":[],"3-2":[]}'::jsonb)$sql$,
    current_setting('test.timetable_profile_a')
  ),
  '23514', null,
  'each course must be an object'
);
select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id, semesters)
      values (%s, '{"1-1":[{"id":"math","name":"Math","color":1,"room":"A"}],"1-2":[],"2-1":[],"2-2":[],"3-1":[],"3-2":[]}'::jsonb)$sql$,
    current_setting('test.timetable_profile_a')
  ),
  '23514', null,
  'courses require a meetings array'
);
select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id, semesters)
      values (%s, '{"1-1":[{"id":"math","name":"Math","color":"1","room":"A","meetings":[]}],"1-2":[],"2-1":[],"2-2":[],"3-1":[],"3-2":[]}'::jsonb)$sql$,
    current_setting('test.timetable_profile_a')
  ),
  '23514', null,
  'course fields must have the required JSON types'
);
select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id, semesters)
      values (%s, '{"1-1":[{"id":"math","name":"Math","color":1,"room":"A","meetings":["meeting"]}],"1-2":[],"2-1":[],"2-2":[],"3-1":[],"3-2":[]}'::jsonb)$sql$,
    current_setting('test.timetable_profile_a')
  ),
  '23514', null,
  'each meeting must be an object'
);
select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id, semesters)
      values (%s, '{"1-1":[{"id":"math","name":"Math","color":1,"room":"A","meetings":[{"id":"m1","day":0,"start":1}]}],"1-2":[],"2-1":[],"2-2":[],"3-1":[],"3-2":[]}'::jsonb)$sql$,
    current_setting('test.timetable_profile_a')
  ),
  '23514', null,
  'meetings require all structural fields'
);
select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id, semesters)
      values (%s, '{"1-1":[{"id":"math","name":"Math","color":1,"room":"A","meetings":[{"id":"m1","day":"0","start":1,"end":2}]}],"1-2":[],"2-1":[],"2-2":[],"3-1":[],"3-2":[]}'::jsonb)$sql$,
    current_setting('test.timetable_profile_a')
  ),
  '23514', null,
  'meeting fields must have the required JSON types'
);
select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id, semesters)
      values (%s, '{"1-1":[{"id":"math","name":"Math","color":1,"room":"A","meetings":[{"id":"m1","day":5,"start":1,"end":2}]}],"1-2":[],"2-1":[],"2-2":[],"3-1":[],"3-2":[]}'::jsonb)$sql$,
    current_setting('test.timetable_profile_a')
  ),
  '23514', null,
  'meeting days must stay within Monday through Friday bounds'
);
select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id, semesters)
      values (%s, '{"1-1":[{"id":"math","name":"Math","color":1,"room":"A","meetings":[{"id":"m1","day":-1,"start":1,"end":2}]}],"1-2":[],"2-1":[],"2-2":[],"3-1":[],"3-2":[]}'::jsonb)$sql$,
    current_setting('test.timetable_profile_a')
  ),
  '23514', null,
  'meeting days cannot fall below the weekday bounds'
);
select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id, semesters)
      values (%s, '{"1-1":[{"id":"math","name":"Math","color":1,"room":"A","meetings":[{"id":"m1","day":0.5,"start":1,"end":2}]}],"1-2":[],"2-1":[],"2-2":[],"3-1":[],"3-2":[]}'::jsonb)$sql$,
    current_setting('test.timetable_profile_a')
  ),
  '23514', null,
  'meeting days must be integers'
);
select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id, semesters)
      values (%s, '{"1-1":[{"id":"math","name":"Math","color":1,"room":"A","meetings":[{"id":"m1","day":0,"start":0,"end":2}]}],"1-2":[],"2-1":[],"2-2":[],"3-1":[],"3-2":[]}'::jsonb)$sql$,
    current_setting('test.timetable_profile_a')
  ),
  '23514', null,
  'meeting periods must stay within 1 through 8 bounds'
);
select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id, semesters)
      values (%s, '{"1-1":[{"id":"math","name":"Math","color":1,"room":"A","meetings":[{"id":"m1","day":0,"start":9,"end":9}]}],"1-2":[],"2-1":[],"2-2":[],"3-1":[],"3-2":[]}'::jsonb)$sql$,
    current_setting('test.timetable_profile_a')
  ),
  '23514', null,
  'meeting starts cannot exceed the period bounds'
);
select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id, semesters)
      values (%s, '{"1-1":[{"id":"math","name":"Math","color":1,"room":"A","meetings":[{"id":"m1","day":0,"start":8,"end":9}]}],"1-2":[],"2-1":[],"2-2":[],"3-1":[],"3-2":[]}'::jsonb)$sql$,
    current_setting('test.timetable_profile_a')
  ),
  '23514', null,
  'meeting ends cannot exceed the period bounds'
);
select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id, semesters)
      values (%s, '{"1-1":[{"id":"math","name":"Math","color":1,"room":"A","meetings":[{"id":"m1","day":0,"start":3,"end":2}]}],"1-2":[],"2-1":[],"2-2":[],"3-1":[],"3-2":[]}'::jsonb)$sql$,
    current_setting('test.timetable_profile_a')
  ),
  '23514', null,
  'meeting end periods cannot precede their start'
);
select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id, semesters)
      values (%s, '{"1-1":[{"id":"math","name":"Math","color":1,"room":"A","meetings":[{"id":"m1","day":0,"start":1.5,"end":2}]}],"1-2":[],"2-1":[],"2-2":[],"3-1":[],"3-2":[]}'::jsonb)$sql$,
    current_setting('test.timetable_profile_a')
  ),
  '23514', null,
  'meeting periods must be integers'
);
select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id, semesters)
      values (%s, '{"1-1":[{"id":"math","name":"Math","color":1,"room":"A","meetings":[{"id":"m1","day":0,"start":4,"end":5}]}],"1-2":[],"2-1":[],"2-2":[],"3-1":[],"3-2":[]}'::jsonb)$sql$,
    current_setting('test.timetable_profile_a')
  ),
  '23514', null,
  'meetings cannot cross the lunch break'
);
select throws_ok(
  format(
    $sql$insert into public.user_timetables (profile_id)
      values (%s)$sql$,
    current_setting('test.timetable_profile_b')
  ),
  '42501', null,
  'a user cannot insert another profile timetable'
);

select lives_ok(
  format(
    $sql$insert into public.user_timetables
      (profile_id, active_semester, semesters, updated_at)
      values (
        %s,
        '1-1',
        '{"clientVersion":2,"1-1":[{"id":"math","name":"Math","color":4,"room":"301","teacher":"Kim","meetings":[{"id":"math-mon","day":0,"start":1,"end":2,"label":"A"},{"id":"math-tue","day":1,"start":5,"end":6}]}],"1-2":[],"2-1":[],"2-2":[],"3-1":[],"3-2":[]}'::jsonb,
        '2000-01-01 00:00:00+00'::timestamptz
      )$sql$,
    current_setting('test.timetable_profile_a')
  ),
  'an owner can insert a structurally valid timetable'
);
select is(
  (select semesters -> '1-1' -> 0 ->> 'name' from public.user_timetables),
  'Math',
  'valid course and meeting data is stored'
);
select is(
  (select semesters ->> 'clientVersion' from public.user_timetables),
  '2',
  'extra root fields remain compatible'
);
select is(
  (select semesters -> '1-1' -> 0 ->> 'teacher' from public.user_timetables),
  'Kim',
  'extra course fields remain compatible'
);
select is(
  (select semesters -> '1-1' -> 0 -> 'meetings' -> 0 ->> 'label' from public.user_timetables),
  'A',
  'extra meeting fields remain compatible'
);
select is(
  (select updated_at from public.user_timetables),
  now(),
  'updated_at is server-controlled on insert'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;

select is(
  (select count(*) from public.user_timetables),
  0::bigint,
  'another user cannot read the owner timetable'
);
select lives_ok(
  format(
    $sql$update public.user_timetables
      set active_semester = '3-2'
      where profile_id = %s$sql$,
    current_setting('test.timetable_profile_a')
  ),
  'another user update is filtered by RLS'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select is(
  (select active_semester from public.user_timetables),
  '1-1',
  'another user cannot change the owner timetable'
);
select lives_ok(
  $$update public.user_timetables
    set active_semester = '2-1',
        updated_at = '1999-01-01 00:00:00+00'::timestamptz$$,
  'an owner can update their timetable'
);
select is(
  (select active_semester from public.user_timetables),
  '2-1',
  'the owner update is stored'
);
select is(
  (select updated_at from public.user_timetables),
  now(),
  'updated_at is server-controlled on update'
);

select * from finish();
rollback;
