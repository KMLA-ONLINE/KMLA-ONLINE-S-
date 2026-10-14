begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

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
  ),
  (
    'sd-request', false, 'unofficial', '검색대상승인가입', 'request', 'identified', 'members',
    (select id from public.profiles where pub_id = 'kim-admin')
  ),
  (
    'sd-mine-invite', false, 'unofficial', '검색대상내초대전용', 'invite_only', 'identified', 'members',
    (select id from public.profiles where pub_id = 'kim-admin')
  ),
  (
    'sd-mine-request', false, 'unofficial', '검색대상내승인가입', 'request', 'identified', 'members',
    (select id from public.profiles where pub_id = 'kim-admin')
  );

-- The caller (auth user ...0001) belongs to two of the private groups.
insert into public.group_memberships (group_id, profile_id)
select group_record.id, caller.id
from public.groups as group_record
cross join public.profiles as caller
where group_record.slug in ('sd-mine-invite', 'sd-mine-request')
  and caller.auth_user_id = '10000000-0000-0000-0000-000000000001';

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
    select array_agg(result_id order by result_id)
    from public.search_directory(p_query => '검색대상')
    where result_kind = 'group'
  ),
  array['sd-mine-invite', 'sd-mine-request', 'sd-open-group'],
  'private groups appear only to their members; open groups appear to everyone'
);

select is(
  (
    select count(*) from public.search_directory(p_query => '검색대상')
    where result_kind = 'group'
      and result_id in ('sd-invite-group', 'sd-request')
  ),
  0::bigint,
  'private groups the caller does not belong to stay hidden'
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
