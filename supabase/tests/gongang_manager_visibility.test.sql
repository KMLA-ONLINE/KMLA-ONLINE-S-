begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000',
  user_id,
  'authenticated',
  'authenticated',
  email,
  '',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now()
from (values
  ('10000000-0000-0000-0000-000000000003'::uuid, 'manager-viewer@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000009'::uuid, 'unlinked@kmla.hs.kr')
) as users(user_id, email);

update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000000003'::uuid
where pub_id = 'hanbyeol-25';

-- 시드의 공강 관리자를 비워 두고, 이 파일이 부여한 권한만 본다.
delete from public.profile_permissions where permission_key = 'gongang.manage';

insert into public.permissions (key, name, description)
values ('test.other', '테스트 권한', '다른 권한은 본인만 본다.');

insert into public.profile_permissions (profile_id, permission_key)
select id, permission_key
from public.profiles
cross join (values ('gongang.manage'), ('test.other')) as keys(permission_key)
where pub_id = 'kim-admin';

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select is(
  (
    select array_agg(profile.pub_id)
    from public.profile_permissions as permission
    join public.profiles as profile on profile.id = permission.profile_id
    where permission.permission_key = 'gongang.manage'
  ),
  array['kim-admin'],
  'an accepted member sees who holds the gongang manager grant'
);

select is(
  (
    select count(*)::int
    from public.profile_permissions
    where permission_key = 'test.other'
  ),
  0,
  'other permission grants stay visible only to their holder'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000009', true);
set local role authenticated;

select is(
  (select count(*)::int from public.profile_permissions),
  0,
  'a signed-in user without an accepted profile sees no grants'
);

reset role;
set local role anon;

select throws_ok(
  'select 1 from public.profile_permissions',
  '42501',
  null,
  'anonymous clients cannot read grants'
);

select * from finish();
rollback;
