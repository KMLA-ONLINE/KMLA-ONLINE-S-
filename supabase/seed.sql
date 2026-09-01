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
  'local-storage-cleanup-only',
  'storage_cleanup_secret',
  'Development-only storage cleanup function secret'
)
where not exists (
  select 1
  from vault.decrypted_secrets
  where name = 'storage_cleanup_secret'
);

select vault.create_secret(
  'local-notification-dispatch-only',
  'notification_dispatch_secret',
  'Development-only notification dispatcher secret'
)
where not exists (
  select 1
  from vault.decrypted_secrets
  where name = 'notification_dispatch_secret'
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

-- 추가 테스트용 29기 학생 계정
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
  '10000000-0000-0000-0000-000000000100',
  'authenticated',
  'authenticated',
  'student2@kmla.hs.kr',
  extensions.crypt('password123', extensions.gen_salt('bf')),
  now(),
  '',
  '',
  '',
  '',
  null,
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
  '10000000-0000-0000-0000-000000000100',
  '10000000-0000-0000-0000-000000000100',
  '{"sub":"10000000-0000-0000-0000-000000000100","email":"student2@kmla.hs.kr","email_verified":true}',
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
  '10000000-0000-0000-0000-000000000100',
  '김민준',
  'student',
  '240002',
  29,
  'male',
  'domestic',
  '2007-05-17',
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
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
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

update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000000098'
where pub_id = 'kim-admin';

insert into public.profiles (
  pub_id, name, type, student_number, cohort, gender, academic_track,
  birthday, status, submitted_at, status_updated_at
)
values
  (
    'pending-user', '승인대기 학생', 'student', '260001', 31, 'female',
    'domestic', '2009-02-01', 'pending', '2026-08-20 00:00:00+00',
    '2026-08-20 00:00:00+00'
  ),
  (
    'blocked-user', '차단 학생', 'student', '260002', 31, 'male',
    'international', '2009-03-01', 'blocked', '2026-08-21 00:00:00+00',
    '2026-08-22 00:00:00+00'
  )
on conflict (lower(pub_id)) do update set
  name = excluded.name,
  status = excluded.status,
  submitted_at = excluded.submitted_at,
  status_updated_at = excluded.status_updated_at,
  updated_at = now();

-- 교사 계정. 그룹을 검색할 수도 가입 요청을 넣을 수도 없어서 초대 링크가 유일한 가입
-- 경로다. 그 경로를 실제로 눌러 볼 수 있도록 로그인 가능한 계정으로 둔다. 어떤 그룹에도
-- 넣지 않는 것이 요점이다.
--
-- auth 사용자 번호가 0099인 이유는 pgTAP 파일들이 `...0002`부터 차례로 자기 사용자를
-- 만들어 seed 프로필에 붙이기 때문이다. 그 대역을 비켜 둬야 테스트가 충돌하지 않는다.
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
  '10000000-0000-0000-0000-000000000099',
  'authenticated',
  'authenticated',
  'teacher@kmla.hs.kr',
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
  '10000000-0000-0000-0000-000000000099',
  '10000000-0000-0000-0000-000000000099',
  '{"sub":"10000000-0000-0000-0000-000000000099","email":"teacher@kmla.hs.kr","email_verified":true}',
  'email',
  now(),
  now(),
  now()
)
on conflict (provider_id, provider) do update set
  identity_data = excluded.identity_data,
  updated_at = now();

insert into public.profiles (auth_user_id, pub_id, name, type, status)
values (
  '10000000-0000-0000-0000-000000000099',
  'jung-teacher',
  '정선생',
  'teacher',
  'accepted'
)
on conflict (auth_user_id) do update set
  name = excluded.name,
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
    '8f2a1c4e6b9d7a',
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
    'optional_anonymous',
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
  -- 로그인 계정이 소유자인 그룹에 역할을 하나씩 채워 둔다. 소유자 자리에서 관리자·매니저·멤버를
  -- 오르내리게 하고 그룹 삭제까지 눌러 볼 수 있어야 한다.
  (
    '20000000-0000-0000-0000-000000000002',
    (select id from public.profiles where pub_id = 'hanbyeol-25'),
    'admin',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    (select id from public.profiles where pub_id = 'saebyeok-24'),
    'manager',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    (select id from public.profiles where pub_id = 'pureum-23'),
    'member',
    null
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
  -- 반대편 자리도 하나 만든다. 여기서는 로그인 계정이 관리자이고 푸름도 관리자라, 관리자가 다른
  -- 관리자의 역할을 바꾸지 못한다는 규칙과 관리자에게는 그룹 삭제가 없다는 것을 바로 볼 수 있다.
  (
    '20000000-0000-0000-0000-000000000005',
    (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001'),
    'admin',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000005',
    (select id from public.profiles where pub_id = 'pureum-23'),
    'admin',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000005',
    (select id from public.profiles where pub_id = 'hanbyeol-25'),
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

-- 댓글 스레드. 익명 번호는 게시물 단위이므로 `private.post_anonymous_aliases`와 각 행의
-- `anon_alias_number`를 함께 맞춘다(0은 `글쓴이`, 1 이상은 `익명n`).
insert into private.post_anonymous_aliases (post_id, profile_id, alias_number)
values
  (
    '90000000-0000-0000-0000-000000000002',
    (select id from public.profiles where pub_id = 'pureum-23'),
    1
  ),
  (
    '90000000-0000-0000-0000-000000000002',
    (select id from public.profiles where pub_id = 'saebyeok-24'),
    2
  )
on conflict (post_id, profile_id) do nothing;

insert into public.post_comments (
  id, post_id, parent_comment_id, root_comment_id, depth, body,
  author_identity, display_author_profile_id, anon_alias_number, created_at, deleted_at
)
values
  -- 익명 게시물의 스레드. 익명1이 묻고 글쓴이가 답한다.
  (
    'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002',
    null, 'a0000000-0000-0000-0000-000000000001', 0,
    '장비 예약은 어디서 하나요?', 'anonymous', null, 1,
    '2026-08-13 02:10:00+00', null
  ),
  (
    'a0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 1,
    '작업실 앞 예약 시트에 적어 두시면 됩니다.', 'anonymous', null, 0,
    '2026-08-13 02:20:00+00', null
  ),
  (
    'a0000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 2,
    '저도 궁금했는데 덕분에 알았습니다.', 'anonymous', null, 2,
    '2026-08-13 02:30:00+00', null
  ),
  -- 삭제된 중간 답글. 아래에 살아 있는 답글이 있어 `삭제된 댓글입니다`로 남는다.
  (
    'a0000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 1,
    '잘못 올린 댓글입니다.', 'anonymous', null, 2,
    '2026-08-13 02:40:00+00', '2026-08-13 02:45:00+00'
  ),
  (
    'a0000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 2,
    '이 답글이 남아 있어서 위 댓글 자리는 유지됩니다.', 'anonymous', null, 1,
    '2026-08-13 02:50:00+00', null
  ),
  (
    'a0000000-0000-0000-0000-000000000006', '90000000-0000-0000-0000-000000000002',
    null, 'a0000000-0000-0000-0000-000000000006', 0,
    '장비 사용 규칙은 공지 글을 함께 확인해 주세요.', 'staff', null, null,
    '2026-08-13 03:10:00+00', null
  ),
  -- 실명 게시물의 스레드.
  (
    'a0000000-0000-0000-0000-000000000007', '90000000-0000-0000-0000-000000000001',
    null, 'a0000000-0000-0000-0000-000000000007', 0,
    '일정 공유 감사합니다. 목요일 회의부터 참여하겠습니다.', 'identified',
    (select id from public.profiles where pub_id = 'pureum-23'), null,
    '2026-08-13 01:10:00+00', null
  ),
  (
    'a0000000-0000-0000-0000-000000000008', '90000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000007', 1,
    '네, 회의실은 그날 다시 공지할게요.', 'identified',
    (select id from public.profiles where pub_id = 'kim-admin'), null,
    '2026-08-13 01:20:00+00', null
  )
on conflict (id) do nothing;

insert into private.comment_authors (comment_id, profile_id)
values
  (
    'a0000000-0000-0000-0000-000000000001',
    (select id from public.profiles where pub_id = 'pureum-23')
  ),
  (
    'a0000000-0000-0000-0000-000000000002',
    (select id from public.profiles where pub_id = 'hanbyeol-25')
  ),
  (
    'a0000000-0000-0000-0000-000000000003',
    (select id from public.profiles where pub_id = 'saebyeok-24')
  ),
  (
    'a0000000-0000-0000-0000-000000000004',
    (select id from public.profiles where pub_id = 'saebyeok-24')
  ),
  (
    'a0000000-0000-0000-0000-000000000005',
    (select id from public.profiles where pub_id = 'pureum-23')
  ),
  (
    'a0000000-0000-0000-0000-000000000006',
    (select id from public.profiles where pub_id = 'kim-admin')
  ),
  (
    'a0000000-0000-0000-0000-000000000007',
    (select id from public.profiles where pub_id = 'pureum-23')
  ),
  (
    'a0000000-0000-0000-0000-000000000008',
    (select id from public.profiles where pub_id = 'kim-admin')
  )
on conflict (comment_id) do nothing;

-- 반응 (기능 명세 §10). 상위 반응 정렬을 확인할 수 있게 종류를 섞어 둔다.
insert into public.post_reactions (post_id, profile_id, reaction, created_at)
values
  (
    '90000000-0000-0000-0000-000000000001',
    (select id from public.profiles where pub_id = 'pureum-23'),
    'like', '2026-08-13 02:10:00+00'
  ),
  (
    '90000000-0000-0000-0000-000000000001',
    (select id from public.profiles where pub_id = 'hanbyeol-25'),
    'like', '2026-08-13 02:12:00+00'
  ),
  (
    '90000000-0000-0000-0000-000000000001',
    (select id from public.profiles where pub_id = 'saebyeok-24'),
    'love', '2026-08-13 02:30:00+00'
  ),
  (
    '90000000-0000-0000-0000-000000000001',
    (select id from public.profiles where pub_id = 'kim-admin'),
    'haha', '2026-08-13 02:45:00+00'
  ),
  (
    '90000000-0000-0000-0000-000000000003',
    (select id from public.profiles where pub_id = 'kim-admin'),
    'like', '2026-08-13 05:00:00+00'
  )
on conflict (post_id, profile_id) do nothing;

insert into public.comment_reactions (comment_id, profile_id, reaction, created_at)
values
  (
    'a0000000-0000-0000-0000-000000000007',
    (select id from public.profiles where pub_id = 'kim-admin'),
    'love', '2026-08-13 01:25:00+00'
  ),
  (
    'a0000000-0000-0000-0000-000000000007',
    (select id from public.profiles where pub_id = 'saebyeok-24'),
    'love', '2026-08-13 01:31:00+00'
  ),
  (
    'a0000000-0000-0000-0000-000000000007',
    (select id from public.profiles where pub_id = 'hanbyeol-25'),
    'haha', '2026-08-13 01:40:00+00'
  ),
  (
    'a0000000-0000-0000-0000-000000000002',
    (select id from public.profiles where pub_id = 'kim-admin'),
    'wow', '2026-08-13 00:55:00+00'
  )
on conflict (comment_id, profile_id) do nothing;
