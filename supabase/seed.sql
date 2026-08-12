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

insert into public.profiles (
  pub_id,
  name,
  role,
  type,
  cohort,
  gender,
  academic_track,
  status
)
values
  (
    '30000000-0000-0000-0000-000000000001',
    '김관리',
    'admin',
    'alumni',
    20,
    'female',
    'domestic',
    'accepted'
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '이한별',
    'member',
    'alumni',
    25,
    'female',
    'international',
    'accepted'
  ),
  (
    '30000000-0000-0000-0000-000000000003',
    '박새벽',
    'member',
    'alumni',
    24,
    'male',
    'domestic',
    'accepted'
  ),
  (
    '30000000-0000-0000-0000-000000000004',
    '최푸름',
    'member',
    'alumni',
    23,
    'male',
    'international',
    'accepted'
  )
on conflict (pub_id) do update set
  name = excluded.name,
  role = excluded.role,
  status = excluded.status,
  updated_at = now();

insert into public.groups (
  id,
  slug,
  slug_is_custom,
  kind,
  name,
  description,
  join_policy,
  identity_policy,
  posting_policy,
  created_by
)
values
  (
    '20000000-0000-0000-0000-000000000001',
    'school-notices',
    true,
    'official',
    '학교 공지',
    '학교의 주요 일정과 공지 사항을 확인하는 공식 그룹입니다.',
    'open',
    'identified',
    'staff',
    (select id from public.profiles where pub_id = '30000000-0000-0000-0000-000000000001')
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'g-8f2a1c4e6b9d7a3c5e10',
    false,
    'unofficial',
    '29기 수학 탐구',
    '함께 문제를 풀고 탐구 주제를 나누는 비공개 그룹입니다.',
    'invite_only',
    'optional_anonymous',
    'members',
    (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001')
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    'makers-lab',
    true,
    'unofficial',
    '메이커스 랩',
    '개발, 로보틱스, 제작 프로젝트를 함께 진행합니다.',
    'open',
    'optional_anonymous',
    'members',
    (select id from public.profiles where pub_id = '30000000-0000-0000-0000-000000000001')
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    'dorm-stories',
    true,
    'unofficial',
    '기숙사 이야기',
    '기숙사 생활의 팁과 이야기를 편하게 나누는 공간입니다.',
    'request',
    'always_anonymous',
    'members',
    (select id from public.profiles where pub_id = '30000000-0000-0000-0000-000000000002')
  ),
  (
    '20000000-0000-0000-0000-000000000005',
    'weekend-hikers',
    true,
    'unofficial',
    '주말 산책단',
    '주말마다 학교 주변을 걷고 계절의 변화를 기록합니다.',
    'open',
    'identified',
    'members',
    (select id from public.profiles where pub_id = '30000000-0000-0000-0000-000000000003')
  ),
  (
    '20000000-0000-0000-0000-000000000006',
    'film-circle',
    true,
    'unofficial',
    '필름 서클',
    '한 편의 영화를 깊게 보고 감상을 나눕니다.',
    'request',
    'optional_anonymous',
    'members',
    (select id from public.profiles where pub_id = '30000000-0000-0000-0000-000000000004')
  )
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  join_policy = excluded.join_policy,
  identity_policy = excluded.identity_policy,
  posting_policy = excluded.posting_policy,
  updated_at = now();

insert into public.group_memberships (group_id, profile_id, role, pinned_at)
values
  (
    '20000000-0000-0000-0000-000000000001',
    (select id from public.profiles where pub_id = '30000000-0000-0000-0000-000000000001'),
    'owner',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000001',
    (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001'),
    'member',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001'),
    'owner',
    now()
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    (select id from public.profiles where pub_id = '30000000-0000-0000-0000-000000000001'),
    'owner',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    (select id from public.profiles where pub_id = '30000000-0000-0000-0000-000000000002'),
    'member',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    (select id from public.profiles where pub_id = '30000000-0000-0000-0000-000000000003'),
    'member',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    (select id from public.profiles where pub_id = '30000000-0000-0000-0000-000000000004'),
    'member',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    (select id from public.profiles where pub_id = '30000000-0000-0000-0000-000000000002'),
    'owner',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    (select id from public.profiles where pub_id = '30000000-0000-0000-0000-000000000003'),
    'member',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    (select id from public.profiles where pub_id = '30000000-0000-0000-0000-000000000004'),
    'member',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000005',
    (select id from public.profiles where pub_id = '30000000-0000-0000-0000-000000000003'),
    'owner',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000005',
    (select id from public.profiles where pub_id = '30000000-0000-0000-0000-000000000004'),
    'member',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000006',
    (select id from public.profiles where pub_id = '30000000-0000-0000-0000-000000000004'),
    'owner',
    null
  )
on conflict (group_id, profile_id) do update set
  role = excluded.role,
  pinned_at = excluded.pinned_at;

insert into public.group_join_requests (group_id, profile_id)
values (
  '20000000-0000-0000-0000-000000000004',
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001')
)
on conflict (group_id, profile_id) do nothing;
