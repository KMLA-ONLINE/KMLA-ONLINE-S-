-- 최소 seed: 로그인 가능한 앱 관리자 계정 하나.
--
-- `seed.sql`과 달리 vault 시크릿을 만들지 않는다. 그 파일의 vault 값은 로컬 개발용이라
-- (`project_url`이 host.docker.internal, dispatch secret이 개발용 상수) 원격 프로젝트에
-- 심기면 알림 dispatcher가 조용히 죽는다. 원격 reset에는 이 파일을 쓴다:
--
--   npx supabase db reset --linked --sql-paths ./seeds/admin-only.sql
--
-- 반복 실행해도 안전하다.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone, phone_change, phone_change_token, email_change_token_current,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0000-000000000098',
  'authenticated', 'authenticated', 'admin@kmla.hs.kr',
  extensions.crypt('rhkgkrrltnfqn', extensions.gen_salt('bf')), now(),
  '', '', '', '', null, '', '', '', '',
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
)
on conflict (id) do update set
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = excluded.email_confirmed_at,
  updated_at = now();

insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at,
  updated_at
)
values (
  '10000000-0000-0000-0000-000000000098',
  '10000000-0000-0000-0000-000000000098',
  '{"sub":"10000000-0000-0000-0000-000000000098","email":"admin@kmla.hs.kr","email_verified":true}',
  'email', now(), now(), now()
)
on conflict (provider_id, provider) do update set
  identity_data = excluded.identity_data,
  updated_at = now();

insert into public.profiles (
  auth_user_id, pub_id, name, role, type, cohort, gender, academic_track, status
)
values (
  '10000000-0000-0000-0000-000000000098',
  'init-admin', '관리자', 'admin', 'alumni', 30, 'male', 'domestic', 'accepted'
)
-- 기존 행이 어떤 모양이든 유효한 alumni 관리자로 완전히 덮어쓴다. 일부 컬럼만 갱신하면
-- 남아 있던 student/teacher 세부값과 섞여 profiles_type_details를 위반할 수 있다.
on conflict (lower(pub_id)) do update set
  auth_user_id = excluded.auth_user_id,
  name = excluded.name,
  role = excluded.role,
  type = excluded.type,
  cohort = excluded.cohort,
  gender = excluded.gender,
  academic_track = excluded.academic_track,
  student_number = null,
  class_no = null,
  dorm_room = null,
  birthday = null,
  status = excluded.status,
  updated_at = now();
