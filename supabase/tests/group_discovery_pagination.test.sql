begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

insert into public.groups (
  slug,
  slug_is_custom,
  kind,
  name,
  join_policy,
  identity_policy,
  posting_policy,
  created_by
)
select
  'paging-group-' || lpad(series::text, 2, '0'),
  true,
  'unofficial',
  '페이지 그룹 ' || lpad(series::text, 2, '0'),
  'open',
  'identified',
  'members',
  (select id from public.profiles
   where pub_id = 'kim-admin')
from generate_series(1, 15) as series;

insert into public.groups (
  slug,
  slug_is_custom,
  kind,
  name,
  join_policy,
  identity_policy,
  posting_policy,
  created_by
)
values
  (
    'search-exact',
    true,
    'unofficial',
    '검색대상',
    'open',
    'identified',
    'members',
    (select id from public.profiles
     where pub_id = 'kim-admin')
  ),
  (
    'search-prefix-popular',
    true,
    'unofficial',
    '검색대상 인기',
    'open',
    'identified',
    'members',
    (select id from public.profiles
     where pub_id = 'kim-admin')
  ),
  (
    'search-prefix-new',
    true,
    'unofficial',
    '검색대상 새내기',
    'open',
    'identified',
    'members',
    (select id from public.profiles
     where pub_id = 'kim-admin')
  ),
  (
    'search-contains-popular',
    true,
    'unofficial',
    '우리 검색대상 연구',
    'open',
    'identified',
    'members',
    (select id from public.profiles
     where pub_id = 'kim-admin')
  ),
  (
    'joined-discovery-check',
    true,
    'unofficial',
    '내가입페이지',
    'open',
    'identified',
    'members',
    (select id from public.profiles
     where pub_id = 'kim-admin')
  );

insert into public.group_memberships (group_id, profile_id)
select group_record.id, profile.id
from public.groups as group_record
cross join public.profiles as profile
where group_record.slug = 'search-prefix-popular'
  and profile.pub_id in (
    'hanbyeol-25',
    'saebyeok-24'
  );

insert into public.group_memberships (group_id, profile_id)
select group_record.id, profile.id
from public.groups as group_record
cross join public.profiles as profile
where group_record.slug = 'search-contains-popular'
  and profile.pub_id in (
    'hanbyeol-25',
    'saebyeok-24',
    'pureum-23'
  );

insert into public.group_memberships (group_id, profile_id)
values (
  (select id from public.groups where slug = 'joined-discovery-check'),
  (select id from public.profiles
   where auth_user_id = '10000000-0000-0000-0000-000000000001')
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select throws_ok(
  $$select * from public.discover_groups(p_after_rank => 0::smallint)$$,
  '22023',
  'all discovery cursor fields are required',
  'partial cursors are rejected'
);

create temp table first_discovery_page on commit drop as
select * from public.discover_groups(p_limit => 5);

select is(
  (select count(*) from first_discovery_page),
  5::bigint,
  'the first discovery page respects its limit'
);

select is(
  (select count(*) from first_discovery_page where slug = 'joined-discovery-check'),
  0::bigint,
  'default discovery excludes joined groups'
);

create temp table second_discovery_page on commit drop as
select next_page.*
from (
  select sort_rank, member_count, group_id
  from first_discovery_page
  order by sort_rank, member_count desc, group_id
  offset 4
  limit 1
) as cursor_row
cross join lateral public.discover_groups(
  p_after_rank => cursor_row.sort_rank,
  p_after_member_count => cursor_row.member_count,
  p_after_id => cursor_row.group_id,
  p_limit => 5
) as next_page;

select is(
  (select count(*) from second_discovery_page),
  5::bigint,
  'the cursor loads a full second page'
);

select is(
  (
    select count(*)
    from first_discovery_page as first_page
    join second_discovery_page as second_page using (group_id)
  ),
  0::bigint,
  'cursor pages do not overlap'
);

select is(
  (
    select membership_state
    from public.discover_groups(
      p_query => '내가입페이지',
      p_include_joined => true
    )
    where slug = 'joined-discovery-check'
  ),
  'member',
  'include-joined exposes the caller membership state'
);

select is(
  (
    select array_agg(name order by sort_rank, member_count desc, group_id)
    from public.discover_groups(p_query => '검색 대상')
  ),
  array[
    '검색대상',
    '검색대상 인기',
    '검색대상 새내기',
    '우리 검색대상 연구'
  ]::text[],
  'search ranks exact, prefix, and contains matches before popularity'
);

select is(
  (
    select array_agg(sort_rank order by sort_rank, member_count desc, group_id)
    from public.discover_groups(p_query => '검색 대상')
  ),
  array[0, 1, 1, 2]::smallint[],
  'search returns stable rank values for the next cursor'
);

select * from finish();
rollback;
