begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

update public.group_memberships
set posts_visited_at = statement_timestamp() - interval '1 hour'
where group_id = '20000000-0000-0000-0000-000000000002'
  and profile_id = (
    select id
    from public.profiles
    where auth_user_id = '10000000-0000-0000-0000-000000000001'
  );

insert into public.posts (
  id, kind, body, group_id, title, author_identity, created_at, published_at
)
values
  (
    '97000000-0000-0000-0000-000000000001', 'group', '다른 멤버의 새 글',
    '20000000-0000-0000-0000-000000000002', '새 글', 'anonymous',
    statement_timestamp() - interval '30 minutes', statement_timestamp() - interval '30 minutes'
  ),
  (
    '97000000-0000-0000-0000-000000000002', 'group', '내 익명 글',
    '20000000-0000-0000-0000-000000000002', '내 글', 'anonymous',
    statement_timestamp() - interval '20 minutes', statement_timestamp() - interval '20 minutes'
  ),
  (
    '97000000-0000-0000-0000-000000000003', 'group', '방문 전 글',
    '20000000-0000-0000-0000-000000000002', '예전 글', 'anonymous',
    statement_timestamp() - interval '2 hours', statement_timestamp() - interval '2 hours'
  ),
  (
    '97000000-0000-0000-0000-000000000004', 'group', '미발행 초안',
    '20000000-0000-0000-0000-000000000002', '초안', 'anonymous',
    statement_timestamp() - interval '10 minutes', null
  );

insert into private.post_authors (post_id, profile_id)
values
  (
    '97000000-0000-0000-0000-000000000001',
    (select id from public.profiles where pub_id = 'hanbyeol-25')
  ),
  (
    '97000000-0000-0000-0000-000000000002',
    (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001')
  ),
  (
    '97000000-0000-0000-0000-000000000003',
    (select id from public.profiles where pub_id = 'hanbyeol-25')
  ),
  (
    '97000000-0000-0000-0000-000000000004',
    (select id from public.profiles where pub_id = 'hanbyeol-25')
  );

select ok(
  has_function_privilege('authenticated', 'public.get_my_group_new_post_counts()', 'EXECUTE'),
  'authenticated can read its group new-post counts'
);
select ok(
  has_function_privilege('authenticated', 'public.mark_group_posts_visited(uuid)', 'EXECUTE'),
  'authenticated can mark its group posts visited'
);
select ok(
  not has_function_privilege('anon', 'public.get_my_group_new_post_counts()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.mark_group_posts_visited(uuid)', 'EXECUTE'),
  'anonymous visitors cannot use group new-post RPCs'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select results_eq(
  $$select new_post_count
    from public.get_my_group_new_post_counts()
    where group_id = '20000000-0000-0000-0000-000000000002'$$,
  array[1::bigint],
  'counts only another member''s published post after the visit watermark'
);

select lives_ok(
  $$select public.mark_group_posts_visited('20000000-0000-0000-0000-000000000002')$$,
  'a member can mark the group post list visited'
);
select is(
  (
    select new_post_count
    from public.get_my_group_new_post_counts()
    where group_id = '20000000-0000-0000-0000-000000000002'
  ),
  0::bigint,
  'marking the list visited clears the new-post count'
);
select throws_ok(
  $$select public.mark_group_posts_visited('20000000-0000-0000-0000-000000000003')$$,
  '42501',
  'group membership required',
  'a non-member cannot advance another group''s watermark'
);

reset role;
set local role anon;
select throws_ok(
  $$select * from public.get_my_group_new_post_counts()$$,
  '42501',
  null,
  'anonymous visitors cannot invoke the count RPC'
);

select * from finish();
rollback;
