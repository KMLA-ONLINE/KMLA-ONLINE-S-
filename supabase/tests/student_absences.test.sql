begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.student_absences',
    'SELECT'
  ),
  'absence rows are not directly readable'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.set_my_absence(text)',
    'EXECUTE'
  ),
  'anonymous users cannot create absences'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);

set local role authenticated;

select throws_ok(
  $$select public.set_my_absence('1')$$,
  '22023',
  null,
  'one character reason is rejected'
);

select throws_ok(
  $$select public.set_my_absence(repeat('가', 101))$$,
  '22023',
  null,
  'long reason is rejected'
);

select lives_ok(
  $$select public.set_my_absence('병원 진료로 오전 수업 공결')$$,
  'student can create absence'
);

select lives_ok(
  $$select public.set_my_absence('병원 진료 일정이 변경되었습니다')$$,
  'same student can replace todays absence'
);

reset role;

select is(
  (
    select count(*)
    from public.student_absences
    where profile_id = (
      select id
      from public.profiles
      where auth_user_id =
        '10000000-0000-0000-0000-000000000001'
    )
  ),
  1::bigint,
  'replacement keeps one record'
);

select is(
  (
    select reason
    from public.student_absences
    where profile_id = (
      select id
      from public.profiles
      where auth_user_id =
        '10000000-0000-0000-0000-000000000001'
    )
  ),
  '병원 진료 일정이 변경되었습니다',
  'replacement stores new reason'
);

-- 테스트용 viewer를 임의의 n=40으로 둔다.
-- 실제 함수에는 40이라는 숫자가 존재하지 않는다.
update public.profiles
set
  cohort = 40,
  is_returning_student = false
where auth_user_id =
  '10000000-0000-0000-0000-000000000001';

insert into public.profiles (
  pub_id,
  name,
  type,
  student_number,
  cohort,
  gender,
  academic_track,
  birthday,
  status,
  is_returning_student
)
values
  (
    'abs-n40',
    '일반 n기',
    'student',
    '990101',
    40,
    'male',
    'domestic',
    '2007-01-01',
    'accepted',
    false
  ),
  (
    'abs-r39',
    '복학 n-1기',
    'student',
    '990102',
    39,
    'female',
    'domestic',
    '2006-01-01',
    'accepted',
    true
  ),
  (
    'abs-n39',
    '일반 n-1기',
    'student',
    '990103',
    39,
    'male',
    'domestic',
    '2006-02-01',
    'accepted',
    false
  ),
  (
    'abs-n41',
    '일반 n+1기',
    'student',
    '990104',
    41,
    'female',
    'domestic',
    '2008-01-01',
    'accepted',
    false
  ),
  (
    'abs-r40',
    '복학 n기',
    'student',
    '990105',
    40,
    'male',
    'domestic',
    '2007-02-01',
    'accepted',
    true
  );

insert into public.student_absences (
  profile_id,
  reason,
  created_at
)
values
  (
    (
      select id from public.profiles
      where pub_id = 'abs-n40'
    ),
    '일반 n기 오늘 공결',
    now()
  ),
  (
    (
      select id from public.profiles
      where pub_id = 'abs-r39'
    ),
    '복학 n-1기 오늘 공결',
    now()
  ),
  (
    (
      select id from public.profiles
      where pub_id = 'abs-n39'
    ),
    '일반 n-1기 오늘 공결',
    now()
  ),
  (
    (
      select id from public.profiles
      where pub_id = 'abs-n41'
    ),
    '일반 n+1기 오늘 공결',
    now()
  ),
  (
    (
      select id from public.profiles
      where pub_id = 'abs-r40'
    ),
    '복학 n기 오늘 공결',
    now()
  ),
  (
    (
      select id from public.profiles
      where pub_id = 'abs-n40'
    ),
    '전날 공결 기록입니다',
    now() - interval '1 day'
  );

set local role authenticated;

select ok(
  exists (
    select 1
    from public.list_today_absences()
    where pub_id = 'abs-n40'
  ),
  'normal n sees normal n'
);

select ok(
  exists (
    select 1
    from public.list_today_absences()
    where pub_id = 'abs-r39'
  ),
  'returning n minus one is exposed as n'
);

select ok(
  not exists (
    select 1
    from public.list_today_absences()
    where pub_id = 'abs-n39'
  ),
  'normal n minus one is excluded'
);

select ok(
  not exists (
    select 1
    from public.list_today_absences()
    where reason = '전날 공결 기록입니다'
  ),
  'previous KST day is excluded'
);

reset role;

-- viewer가 복학생 n이면 조회 기수는 자동으로 n+1.
update public.profiles
set is_returning_student = true
where auth_user_id =
  '10000000-0000-0000-0000-000000000001';

set local role authenticated;

select ok(
  exists (
    select 1
    from public.list_today_absences()
    where pub_id = 'abs-n41'
  ),
  'returning n viewer sees normal n plus one'
);

select ok(
  exists (
    select 1
    from public.list_today_absences()
    where pub_id = 'abs-r40'
  ),
  'returning n is exposed as n plus one'
);

select ok(
  not exists (
    select 1
    from public.list_today_absences()
    where pub_id = 'abs-n40'
  ),
  'returning n viewer does not read normal n list'
);

reset role;

select * from finish();

rollback;
