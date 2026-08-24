begin;

create extension if not exists pgtap with schema extensions;
select plan(23);

select ok(
  not has_table_privilege(
    'authenticated',
    'private.group_post_reports',
    'SELECT'
  ),
  'report records are not directly readable'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.report_group_post(uuid,public.group_post_report_reason,text)',
    'EXECUTE'
  ),
  'anonymous users cannot report posts'
);

select ok(
  (
    select coalesce(
      bool_and(
        lower(pg_get_function_result(p.oid)) not like '%reporter%'
      ),
      false
    )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'list_group_post_report_summaries'
  ),
  'report summaries expose no reporter identifier'
);

select ok(
  (
    select coalesce(
      bool_and(
        lower(pg_get_function_result(p.oid)) not like '%reporter%'
      ),
      false
    )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'list_group_post_report_descriptions'
  ),
  'report descriptions expose no reporter identifier'
);

insert into public.posts (
  id,
  kind,
  body,
  group_id,
  title,
  author_identity,
  display_author_profile_id,
  created_at,
  published_at
)
values (
  '91000000-0000-0000-0000-000000000002',
  'group',
  '신고 유효성 검사용 본문',
  '20000000-0000-0000-0000-000000000002',
  '신고 유효성 검사용 글',
  'identified',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  now(),
  now()
);

insert into private.post_authors (post_id, profile_id)
values (
  '91000000-0000-0000-0000-000000000002',
  (select id from public.profiles where pub_id = 'hanbyeol-25')
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);

set local role authenticated;

select lives_ok(
  $$select public.report_group_post(
    '90000000-0000-0000-0000-000000000003',
    'spam',
    '반복 광고 게시물'
  )$$,
  'member can report another members post'
);

select throws_ok(
  $$select public.report_group_post(
    '90000000-0000-0000-0000-000000000003',
    'spam',
    '다시 신고합니다'
  )$$,
  '23505',
  null,
  'same member cannot report the same post twice'
);

select throws_ok(
  $$select public.report_group_post(
    '91000000-0000-0000-0000-000000000002',
    'other',
    null
  )$$,
  '22023',
  null,
  'other requires a description'
);

select throws_ok(
  $$select public.report_group_post(
    '91000000-0000-0000-0000-000000000002',
    'privacy',
    '짧음'
  )$$,
  '22023',
  null,
  'provided descriptions must have at least five characters'
);

select lives_ok(
  $$select public.create_group_post(
    '20000000-0000-0000-0000-000000000002',
    '자기 신고 검사용 글',
    '자기 신고 검사용 본문',
    'identified',
    null
  )$$,
  'member can create a post used for self-report testing'
);

select throws_ok(
  $$select public.report_group_post(
    (
      select id
      from public.posts
      where title = '자기 신고 검사용 글'
    ),
    'abuse',
    '자기 글 신고 시도'
  )$$,
  '42501',
  null,
  'authors cannot report their own post'
);

select throws_ok(
  $$select public.report_group_post(
    '90000000-0000-0000-0000-000000000001',
    'spam',
    '가입하지 않은 그룹 신고'
  )$$,
  '42501',
  null,
  'non-members cannot report group posts'
);

select throws_ok(
  $$select * from public.list_group_post_report_summaries(
    '20000000-0000-0000-0000-000000000001'
  )$$,
  '42501',
  null,
  'ordinary members cannot read report summaries'
);

reset role;

update public.group_memberships
set role = 'manager'
where group_id = '20000000-0000-0000-0000-000000000001'
  and profile_id = (
    select id
    from public.profiles
    where auth_user_id = '10000000-0000-0000-0000-000000000001'
  );

set local role authenticated;

select is(
  (
    select count(*)
    from public.list_group_post_report_summaries(
      '20000000-0000-0000-0000-000000000001'
    )
  ),
  1::bigint,
  'manager can read reported posts'
);

select is(
  (
    select report_count
    from public.list_group_post_report_summaries(
      '20000000-0000-0000-0000-000000000001'
    )
    where post_id = '90000000-0000-0000-0000-000000000003'
  ),
  1::bigint,
  'report count is aggregated'
);

select is(
  (
    select spam_count
    from public.list_group_post_report_summaries(
      '20000000-0000-0000-0000-000000000001'
    )
    where post_id = '90000000-0000-0000-0000-000000000003'
  ),
  1::bigint,
  'reason count is aggregated'
);

select is(
  (
    select description_count
    from public.list_group_post_report_summaries(
      '20000000-0000-0000-0000-000000000001'
    )
    where post_id = '90000000-0000-0000-0000-000000000003'
  ),
  1::bigint,
  'description count is aggregated'
);

select is(
  (
    select count(*)
    from public.list_group_post_report_descriptions(
      '20000000-0000-0000-0000-000000000001',
      '90000000-0000-0000-0000-000000000003'
    )
  ),
  1::bigint,
  'manager can lazily load report descriptions'
);

select is(
  (
    select description
    from public.list_group_post_report_descriptions(
      '20000000-0000-0000-0000-000000000001',
      '90000000-0000-0000-0000-000000000003'
    )
    limit 1
  ),
  '반복 광고 게시물',
  'report description is returned without reporter identity'
);

reset role;

delete from public.group_join_requests
where group_id = '20000000-0000-0000-0000-000000000004'
  and profile_id = (
    select id
    from public.profiles
    where auth_user_id = '10000000-0000-0000-0000-000000000001'
  );

insert into public.group_memberships (
  group_id,
  profile_id,
  role
)
values (
  '20000000-0000-0000-0000-000000000004',
  (
    select id
    from public.profiles
    where auth_user_id = '10000000-0000-0000-0000-000000000001'
  ),
  'manager'
);

insert into public.posts (
  id,
  kind,
  body,
  group_id,
  title,
  author_identity,
  created_at,
  published_at
)
values (
  '91000000-0000-0000-0000-000000000004',
  'group',
  '익명 그룹 신고 검사용 본문',
  '20000000-0000-0000-0000-000000000004',
  '익명 그룹 신고 검사용 글',
  'anonymous',
  now(),
  now()
);

insert into private.post_authors (
  post_id,
  profile_id
)
values (
  '91000000-0000-0000-0000-000000000004',
  (select id from public.profiles where pub_id = 'hanbyeol-25')
);

insert into private.group_post_reports (
  post_id,
  reporter_profile_id,
  reason,
  description
)
values (
  '91000000-0000-0000-0000-000000000004',
  (select id from public.profiles where pub_id = 'pureum-23'),
  'privacy',
  '개인정보가 포함되어 있습니다'
);

set local role authenticated;

select is(
  (
    select author_pub_id
    from public.list_group_post_report_summaries(
      '20000000-0000-0000-0000-000000000004'
    )
    where post_id = '91000000-0000-0000-0000-000000000004'
  ),
  null::text,
  'anonymous report view exposes no profile id'
);

select is(
  (
    select author_name
    from public.list_group_post_report_summaries(
      '20000000-0000-0000-0000-000000000004'
    )
    where post_id = '91000000-0000-0000-0000-000000000004'
  ),
  null::text,
  'anonymous report view exposes no author name'
);

select is(
  (
    select author_avatar_path
    from public.list_group_post_report_summaries(
      '20000000-0000-0000-0000-000000000004'
    )
    where post_id = '91000000-0000-0000-0000-000000000004'
  ),
  null::text,
  'anonymous report view exposes no author avatar'
);

reset role;

update public.group_memberships
set role = 'admin'
where group_id = '20000000-0000-0000-0000-000000000001'
  and profile_id = (
    select id
    from public.profiles
    where auth_user_id = '10000000-0000-0000-0000-000000000001'
  );

set local role authenticated;

select lives_ok(
  $$select public.delete_group_post(
    '90000000-0000-0000-0000-000000000003'
  )$$,
  'admin can delete a reported post'
);

reset role;

select is(
  (
    select count(*)
    from private.group_post_reports
    where post_id = '90000000-0000-0000-0000-000000000003'
  ),
  0::bigint,
  'reports are removed when their post is deleted'
);

select * from finish();
rollback;
