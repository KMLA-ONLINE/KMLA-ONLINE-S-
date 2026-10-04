begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

select throws_ok(
  $$insert into public.profiles (
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
      'admin',
      '관리자 테스트',
      'student',
      '980001',
      30,
      'male',
      'domestic',
      '2008-01-01',
      'accepted'
    )$$,
  '23514',
  null,
  'admin is rejected as a reserved profile public id'
);

select throws_ok(
  $$insert into public.profiles (
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
      'sibal',
      '금지어 테스트',
      'student',
      '980002',
      30,
      'male',
      'domestic',
      '2008-01-01',
      'accepted'
    )$$,
  '23514',
  null,
  'reserved profile public ids are rejected'
);

select lives_ok(
  $$insert into public.profiles (
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
      'minki-30',
      '정상 테스트',
      'student',
      '980003',
      30,
      'male',
      'international',
      '2008-01-01',
      'accepted'
    )$$,
  'normal profile public ids remain valid'
);

select * from finish();

rollback;
