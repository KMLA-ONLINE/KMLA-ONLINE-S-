-- Development seed data. Runs on `npm run db:reset` after every migration.
-- Keep this idempotent and safe to run repeatedly; it never touches production.

select vault.create_secret(
  'http://host.docker.internal:54621',
  'project_url',
  'Local API URL used by scheduled development jobs'
)
where not exists (
  select 1 from vault.decrypted_secrets where name = 'project_url'
);

select vault.create_secret(
  'local-post-attachment-cleanup-only',
  'post_attachment_cleanup_secret',
  'Development-only cleanup function secret'
)
where not exists (
  select 1
  from vault.decrypted_secrets
  where name = 'post_attachment_cleanup_secret'
);

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
    'kim-admin',
    '김관리',
    'admin',
    'alumni',
    20,
    'female',
    'domestic',
    'accepted'
  ),
  (
    'hanbyeol-25',
    '이한별',
    'member',
    'alumni',
    25,
    'female',
    'international',
    'accepted'
  ),
  (
    'saebyeok-24',
    '박새벽',
    'member',
    'alumni',
    24,
    'male',
    'domestic',
    'accepted'
  ),
  (
    'pureum-23',
    '최푸름',
    'member',
    'alumni',
    23,
    'male',
    'international',
    'accepted'
  )
on conflict (lower(pub_id)) do update set
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
    (select id from public.profiles where pub_id = 'kim-admin')
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
    (select id from public.profiles where pub_id = 'kim-admin')
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
    (select id from public.profiles where pub_id = 'hanbyeol-25')
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
    (select id from public.profiles where pub_id = 'saebyeok-24')
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
    (select id from public.profiles where pub_id = 'pureum-23')
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
    (select id from public.profiles where pub_id = 'kim-admin'),
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
    (select id from public.profiles where pub_id = 'kim-admin'),
    'owner',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    (select id from public.profiles where pub_id = 'hanbyeol-25'),
    'member',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    (select id from public.profiles where pub_id = 'saebyeok-24'),
    'member',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    (select id from public.profiles where pub_id = 'pureum-23'),
    'member',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    (select id from public.profiles where pub_id = 'hanbyeol-25'),
    'owner',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    (select id from public.profiles where pub_id = 'saebyeok-24'),
    'member',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    (select id from public.profiles where pub_id = 'pureum-23'),
    'member',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000005',
    (select id from public.profiles where pub_id = 'saebyeok-24'),
    'owner',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000005',
    (select id from public.profiles where pub_id = 'pureum-23'),
    'member',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000006',
    (select id from public.profiles where pub_id = 'pureum-23'),
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

insert into public.group_categories (id, group_id, name, position)
values
  ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '필독', 0),
  ('80000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', '제작', 0),
  ('80000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', '질문', 1)
on conflict (id) do update set
  name = excluded.name,
  position = excluded.position,
  updated_at = now();

insert into public.posts (
  id, kind, body, group_id, title, category_id, author_identity,
  display_author_profile_id, pinned_at, created_at, published_at
)
values
  (
    '90000000-0000-0000-0000-000000000001', 'group',
    '이번 주 프로젝트 일정을 확인해 주세요.',
    '20000000-0000-0000-0000-000000000003', '이번 주 프로젝트 일정',
    '80000000-0000-0000-0000-000000000002', 'identified',
    (select id from public.profiles where pub_id = 'kim-admin'),
    '2026-08-13 01:00:00+00', '2026-08-13 00:00:00+00', '2026-08-13 00:00:00+00'
  ),
  (
    '90000000-0000-0000-0000-000000000002', 'group',
    '익명으로 남기는 제작 장비 사용 팁입니다.',
    '20000000-0000-0000-0000-000000000003', '제작 장비 사용 팁',
    null, 'anonymous', null, null,
    '2026-08-13 02:00:00+00', '2026-08-13 02:00:00+00'
  ),
  (
    '90000000-0000-0000-0000-000000000003', 'group',
    '학교 행사 준비 일정을 안내합니다.',
    '20000000-0000-0000-0000-000000000001', '학교 행사 준비 안내',
    '80000000-0000-0000-0000-000000000001', 'staff', null, null,
    '2026-08-13 03:00:00+00', '2026-08-13 03:00:00+00'
  )
on conflict (id) do update set
  body = excluded.body,
  title = excluded.title,
  category_id = excluded.category_id,
  pinned_at = excluded.pinned_at;

insert into private.post_authors (post_id, profile_id)
values
  (
    '90000000-0000-0000-0000-000000000001',
    (select id from public.profiles where pub_id = 'kim-admin')
  ),
  (
    '90000000-0000-0000-0000-000000000002',
    (select id from public.profiles where pub_id = 'hanbyeol-25')
  ),
  (
    '90000000-0000-0000-0000-000000000003',
    (select id from public.profiles where pub_id = 'kim-admin')
  )
on conflict (post_id) do update set profile_id = excluded.profile_id;
