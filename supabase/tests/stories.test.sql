begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'stories'
      and policyname = 'stories_deny_direct_access'
      and roles = array['public']::name[]
      and cmd = 'ALL'
      and qual = 'false'
      and with_check = 'false'
  ),
  'story rows have an explicit deny-all RLS policy'
);

select ok(
  not has_table_privilege('authenticated', 'public.stories', 'SELECT'),
  'story rows are not directly readable'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.set_my_story(text)',
    'EXECUTE'
  ),
  'anonymous users cannot create stories'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);

set local role authenticated;

select throws_ok(
  $$select public.set_my_story('1')$$,
  '22023',
  null,
  'one character story is rejected'
);

select throws_ok(
  $$select public.set_my_story(repeat('가', 101))$$,
  '22023',
  null,
  'long story is rejected'
);

select throws_ok(
  $$select public.set_my_story('   ')$$,
  '22023',
  null,
  'blank story is rejected'
);

select throws_ok(
  $$select public.set_my_story(null)$$,
  '22023',
  null,
  'null story is rejected'
);

select lives_ok(
  $$select public.set_my_story('오늘 급식이 좋았다')$$,
  'student can create a story'
);

select lives_ok(
  $$select public.set_my_story('  생각이 바뀌었다  ')$$,
  'same student can replace todays story'
);

reset role;

select is(
  (
    select count(*)
    from public.stories
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
    select content
    from public.stories
    where profile_id = (
      select id
      from public.profiles
      where auth_user_id =
        '10000000-0000-0000-0000-000000000001'
    )
  ),
  '생각이 바뀌었다',
  'replacement stores the trimmed new content'
);

-- 노출은 작성자 유형으로만 갈린다. 기수는 판정에 쓰지 않으므로 뷰어와 먼 기수의 재학생도
-- 보여야 한다(기능 명세 §6.6).
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
    'story-near',
    '같은 기수 재학생',
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
    'story-far',
    '먼 기수 재학생',
    'student',
    '990102',
    12,
    'female',
    'domestic',
    '1995-01-01',
    'accepted',
    false
  );

insert into public.profiles (pub_id, name, type, status)
values ('story-teach', '스토리 쓰는 교사', 'teacher', 'accepted');

insert into public.stories (profile_id, content, created_at)
values
  (
    (select id from public.profiles where pub_id = 'story-near'),
    '오늘 재학생 스토리',
    now()
  ),
  (
    (select id from public.profiles where pub_id = 'story-far'),
    '먼 기수 재학생 스토리',
    now()
  ),
  (
    (select id from public.profiles where pub_id = 'story-teach'),
    '오늘 교사 스토리',
    now()
  ),
  (
    (select id from public.profiles where pub_id = 'story-near'),
    '전날 기록입니다',
    now() - interval '1 day'
  );

set local role authenticated;

select ok(
  exists (
    select 1
    from public.list_today_stories()
    where pub_id = 'story-near'
  ),
  'student viewer sees a student story'
);

select ok(
  exists (
    select 1
    from public.list_today_stories()
    where pub_id = 'story-far'
  ),
  'student viewer sees a student story from a distant cohort'
);

select ok(
  exists (
    select 1
    from public.list_today_stories()
    where pub_id = 'story-teach'
  ),
  'student viewer sees a teacher story'
);

select ok(
  not exists (
    select 1
    from public.list_today_stories()
    where content = '전날 기록입니다'
  ),
  'previous KST day is excluded'
);

reset role;

-- 뷰어를 교사로 바꾼다. 교사 프로필은 학생 전용 열을 모두 비워야 한다.
update public.profiles
set
  type = 'teacher',
  student_number = null,
  class_no = null,
  cohort = null,
  gender = null,
  academic_track = null,
  dorm_room = null
where auth_user_id =
  '10000000-0000-0000-0000-000000000001';

set local role authenticated;

select ok(
  exists (
    select 1
    from public.list_today_stories()
    where pub_id = 'story-near'
  ),
  'teacher viewer sees a student story'
);

select lives_ok(
  $$select public.set_my_story('교사도 스토리를 남긴다')$$,
  'teacher can create a story'
);

reset role;

-- 뷰어를 졸업생으로 바꾼다. 졸업생 프로필은 반과 호실을 비워야 한다.
update public.profiles
set
  type = 'alumni',
  cohort = 29,
  gender = 'male',
  academic_track = 'domestic',
  class_no = null,
  dorm_room = null
where auth_user_id =
  '10000000-0000-0000-0000-000000000001';

set local role authenticated;

select ok(
  not exists (
    select 1
    from public.list_today_stories()
    where pub_id in ('story-near', 'story-far')
  ),
  'alumni viewer does not see student stories'
);

select ok(
  exists (
    select 1
    from public.list_today_stories()
    where pub_id = 'story-teach'
  ),
  'alumni viewer still sees a teacher story'
);

select throws_ok(
  $$select public.set_my_story('졸업생은 못 쓴다')$$,
  '42501',
  null,
  'alumni cannot create a story'
);

select throws_ok(
  $$select public.delete_my_story()$$,
  '42501',
  null,
  'alumni cannot delete a story'
);

reset role;

select * from finish();

rollback;
