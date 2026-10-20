begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

-- 시행 중인 약관 판. 날짜를 적어 두면 개정 때마다 테스트도 고쳐야 한다. 함수는 private라
-- authenticated가 부를 수 없으므로 여기서 읽어 둔다.
select set_config('test.terms_version', private.current_terms_version()::text, true);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000', user_id, 'authenticated',
  'authenticated', email, '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values
  ('20000000-0000-0000-0000-000000000001'::uuid, 'terms-new-student@kmla.hs.kr'),
  ('20000000-0000-0000-0000-000000000002'::uuid, 'terms-new-alumni@kmla.hs.kr')
) as users(user_id, email);

-- 시드의 승인 회원은 약관 시행 전에 가입한 기존 회원과 같다.
update public.profiles
set terms_version = null, terms_agreed_at = null
where auth_user_id = '10000000-0000-0000-0000-000000000001';

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'terms_version', 'SELECT')
    and not has_column_privilege('authenticated', 'public.profiles', 'terms_agreed_at', 'SELECT'),
  'other members cannot read terms agreement columns'
);
select ok(
  has_function_privilege('authenticated', 'public.agree_to_terms(date)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.agree_to_terms(date)', 'EXECUTE'),
  'only signed-in users can record a terms agreement'
);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$select public.submit_my_profile(
      p_name => '약관 미동의', p_type => 'student', p_student_number => '269001',
      p_cohort => 32::smallint
    )$$,
  '22023', 'current terms agreement required',
  'a profile cannot be submitted without agreeing to the terms'
);
select throws_ok(
  $$select public.submit_my_profile(
      p_name => '옛 약관', p_type => 'student', p_student_number => '269001',
      p_cohort => 32::smallint, p_terms_version => (current_setting('test.terms_version')::date - 1)
    )$$,
  '22023', 'current terms agreement required',
  'a profile cannot be submitted with a stale terms version'
);
select lives_ok(
  $$select public.submit_my_profile(
      p_name => '선택 정보 없음', p_type => 'student', p_student_number => '269001',
      p_cohort => 32::smallint, p_terms_version => current_setting('test.terms_version')::date
    )$$,
  'a student can submit without birthday, gender, academic track or phone'
);
select is(
  (select terms_version from public.get_my_profile()),
  current_setting('test.terms_version')::date,
  'profile submission records the agreed terms version'
);
select ok(
  (select terms_agreed_at is not null from public.get_my_profile()),
  'profile submission records when the terms were agreed'
);

reset role;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select lives_ok(
  $$select public.submit_my_profile(
      p_name => '졸업생 선택 없음', p_type => 'alumni', p_cohort => 20::smallint,
      p_terms_version => current_setting('test.terms_version')::date
    )$$,
  'an alumnus can submit without student number, gender or academic track'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(
  (select terms_agreed_at from public.get_my_profile()),
  null::timestamptz,
  'an existing member starts without a terms agreement'
);
select throws_ok(
  $$select public.agree_to_terms((current_setting('test.terms_version')::date - 1))$$,
  '22023', 'current terms agreement required',
  'an existing member cannot agree to a stale terms version'
);
select lives_ok(
  $$select public.agree_to_terms(current_setting('test.terms_version')::date)$$,
  'an existing member can agree to the current terms'
);
select is(
  (select terms_version from public.get_my_profile()),
  current_setting('test.terms_version')::date,
  'agreeing records the current terms version'
);
select set_config(
  'test.first_agreed_at',
  (select terms_agreed_at::text from public.get_my_profile()),
  true
);
select lives_ok(
  $$select public.agree_to_terms(current_setting('test.terms_version')::date)$$,
  'agreeing again is harmless'
);
select is(
  (select terms_agreed_at from public.get_my_profile()),
  current_setting('test.first_agreed_at')::timestamptz,
  'agreeing again keeps the first agreement time'
);

select lives_ok(
  $$select public.update_my_profile(
      p_name => (select name from public.get_my_profile()),
      p_cohort => (select cohort from public.get_my_profile()),
      p_pub_id => (select pub_id from public.get_my_profile())
    )$$,
  'a member can clear birthday, gender and academic track'
);
select ok(
  (
    select birthday is null and gender is null and academic_track is null
    from public.get_my_profile()
  ),
  'cleared optional fields are removed from the profile'
);

-- 시행 판은 약관을 개정할 때 함수를 바꿔 올린다. IMMUTABLE이면 식 인덱스나 생성 열에 값이 굳을 수 있다.
select is(
  (select provolatile from pg_proc where oid = 'private.current_terms_version()'::regprocedure),
  's'::"char",
  'current terms version is stable, not immutable'
);

select * from finish();
rollback;
