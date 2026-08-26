begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

insert into public.profiles (
  pub_id, name, type, student_number, cohort, gender, academic_track,
  birthday, is_returning_student, status
)
values
  ('birth-cur31', '현재 31기', 'student', '260031', 31, 'female', 'domestic', '2009-08-26', false, 'accepted'),
  ('birth-cur29', '현재 29기', 'student', '240029', 29, 'male', 'international', '2007-08-27', false, 'accepted'),
  ('birth-ret28', '복학 28기', 'student', '230028', 28, 'female', 'domestic', '2006-08-28', true, 'accepted'),
  ('birth-out28', '일반 28기', 'student', '230029', 28, 'male', 'international', '2006-08-26', false, 'accepted'),
  ('birth-ret29', '복학 29기', 'student', '240030', 29, 'female', 'domestic', '2007-08-26', true, 'accepted'),
  ('birth-pending', '대기 31기', 'student', '260032', 31, 'male', 'international', '2009-08-26', false, 'pending'),
  ('birth-alumni', '졸업생', 'alumni', null, 25, 'female', 'domestic', '2004-08-26', false, 'accepted'),
  ('birth-past', '지난 경계', 'student', '260033', 31, 'male', 'domestic', '2009-07-26', false, 'accepted'),
  ('birth-future', '앞 경계', 'student', '260034', 31, 'female', 'international', '2009-09-26', false, 'accepted'),
  ('birth-before', '지난 범위 밖', 'student', '260035', 31, 'male', 'domestic', '2009-07-25', false, 'accepted'),
  ('birth-after', '앞 범위 밖', 'student', '260036', 31, 'female', 'international', '2009-09-27', false, 'accepted'),
  ('birth-leap', '윤년 생일', 'teacher', null, null, null, null, '1984-02-29', false, 'accepted'),
  ('birth-newyear', '새해 생일', 'teacher', null, null, null, null, '1984-01-01', false, 'accepted');

select ok(
  has_function_privilege('authenticated', 'public.list_birthdays(date, text)', 'EXECUTE'),
  'authenticated users can list birthdays'
);
select ok(
  not has_function_privilege('anon', 'public.list_birthdays(date, text)', 'EXECUTE'),
  'anonymous users cannot list birthdays'
);

set local role anon;
select throws_ok(
  $$select * from public.list_birthdays('2026-08-26', 'today')$$,
  '42501',
  null,
  'anonymous users cannot call the birthday listing'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select is(
  (select count(*) from public.list_birthdays('2026-08-26', 'today')),
  1::bigint,
  'today includes only the matching current student'
);
select ok(
  exists (
    select 1
    from public.list_birthdays('2026-08-26', 'today')
    where pub_id = 'birth-cur31'
      and birthday_month = 8
      and birthday_day = 26
      and birthday_date = '2026-08-26'
  ),
  'today returns presentation-safe birthday fields for a current student'
);
select ok(
  not exists (
    select 1
    from public.list_birthdays('2026-08-26', 'today')
    where pub_id in (
      'birth-out28',
      'birth-ret29',
      'birth-pending',
      'birth-alumni'
    )
  ),
  'the listing excludes out-of-range, pending, and alumni profiles'
);
select ok(
  exists (
    select 1
    from public.list_birthdays('2026-08-27', 'today')
    where pub_id = 'birth-cur29'
  ),
  'the listing includes current lower-grade students'
);
select ok(
  exists (
    select 1
    from public.list_birthdays('2026-08-28', 'today')
    where pub_id = 'birth-ret28'
  ),
  'the listing includes the eligible returning cohort'
);
select ok(
  exists (
    select 1
    from public.list_birthdays('2026-02-28', 'today')
    where pub_id = 'birth-leap'
  ),
  'teachers are included regardless of cohort'
);
select is(
  (
    select count(*)
    from public.list_birthdays('2026-08-26', 'month')
    where pub_id in ('birth-past', 'birth-future')
  ),
  2::bigint,
  'the calendar-month range includes both boundaries'
);
select is(
  (
    select count(*)
    from public.list_birthdays('2026-08-26', 'month')
    where pub_id in ('birth-before', 'birth-after')
  ),
  0::bigint,
  'the calendar-month range excludes dates outside its boundaries'
);
select ok(
  exists (
    select 1
    from public.list_birthdays('2027-02-28', 'today')
    where pub_id = 'birth-leap'
      and birthday_date = '2027-02-28'
  ),
  'February 29 birthdays fall on February 28 outside leap years'
);
select ok(
  exists (
    select 1
    from public.list_birthdays('2026-12-31', 'month')
    where pub_id = 'birth-newyear'
      and birthday_date = '2027-01-01'
  ),
  'the range spans into the next calendar year'
);
select throws_ok(
  $$select * from public.list_birthdays('2026-08-26', 'all')$$,
  '22023',
  'birthday scope must be today or month',
  'the birthday listing rejects arbitrary scopes'
);

select * from finish();
rollback;
