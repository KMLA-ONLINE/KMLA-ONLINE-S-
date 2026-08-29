begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

-- Rename an existing seeded profile so it has a distinctive, unambiguous name for
-- this test. Renaming (rather than inserting) sidesteps profiles.auth_user_id's
-- foreign key into auth.users, which the seed's identity fixtures already satisfy.
update public.profiles set name = '검색대상인물' where pub_id = 'pureum-23';

insert into public.groups (
  slug, slug_is_custom, kind, name, join_policy, identity_policy, posting_policy, created_by
)
values
  (
    'sd-open-group', true, 'unofficial', '검색대상그룹', 'open', 'identified', 'members',
    (select id from public.profiles where pub_id = 'kim-admin')
  ),
  (
    'sd-invite-group', true, 'unofficial', '검색대상초대전용', 'invite_only', 'identified', 'members',
    (select id from public.profiles where pub_id = 'kim-admin')
  );

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select is(
  (select count(*) from public.search_directory(p_query => '검')),
  0::bigint,
  'a one-character query returns nothing'
);

select is(
  (
    select result_name from public.search_directory(p_query => '검색대상인물')
    where result_kind = 'profile'
  ),
  '검색대상인물',
  'an accepted profile matches by name'
);

select is(
  (
    select array_agg(result_id order by result_name)
    from public.search_directory(p_query => '검색대상')
    where result_kind = 'group'
  ),
  array['sd-open-group'],
  'invite-only unofficial groups are excluded from group results'
);

select is(
  (select count(*) from public.search_directory(p_query => '검색대상') where result_kind = 'profile'),
  1::bigint,
  'people and group matches for the same prefix do not leak into each other''s bucket'
);

-- Switch to the teacher fixture.
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000099',
  true
);

select is(
  (select count(*) from public.search_directory(p_query => '검색대상') where result_kind = 'group'),
  0::bigint,
  'teachers never receive group results'
);

select is(
  (select count(*) from public.search_directory(p_query => '검색대상인물') where result_kind = 'profile'),
  1::bigint,
  'teachers still receive people results'
);

select set_config('request.jwt.claim.sub', '', true);

select throws_ok(
  $$select * from public.search_directory(p_query => '검색')$$,
  '42501',
  null,
  'an unauthenticated caller is rejected'
);

select * from finish();
rollback;
