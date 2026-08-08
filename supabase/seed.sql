-- Development seed data. Runs on `npm run db:reset` after every migration.
-- Keep this idempotent and safe to run repeatedly; it never touches production.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  phone,
  phone_change,
  phone_change_token,
  email_change_token_current,
  reauthentication_token,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'student@kmla.hs.kr',
  extensions.crypt('password123', extensions.gen_salt('bf')),
  now(),
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now()
)
on conflict (id) do update set
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = excluded.email_confirmed_at,
  updated_at = now();

insert into auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values (
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '{"sub":"10000000-0000-0000-0000-000000000001","email":"student@kmla.hs.kr","email_verified":true}',
  'email',
  now(),
  now(),
  now()
)
on conflict (provider_id, provider) do update set
  identity_data = excluded.identity_data,
  updated_at = now();

insert into public.profiles (
  auth_user_id,
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
  '10000000-0000-0000-0000-000000000001',
  '홍길동',
  'student',
  '240001',
  29,
  'male',
  'domestic',
  '2007-01-01',
  'accepted'
)
on conflict (auth_user_id) do update set
  name = excluded.name,
  status = excluded.status,
  updated_at = now();
