begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

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
  has_function_privilege('authenticated', 'public.mark_group_posts_visited(uuid, timestamptz)', 'EXECUTE'),
  'authenticated can mark its group posts visited'
);
select ok(
  not has_function_privilege('anon', 'public.get_my_group_new_post_counts()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.mark_group_posts_visited(uuid, timestamptz)', 'EXECUTE'),
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
  $$select public.mark_group_posts_visited(
    '20000000-0000-0000-0000-000000000002',
    statement_timestamp() - interval '40 minutes'
  )$$,
  'a member can mark the group post list visited up to the newest shown post'
);
select is(
  (
    select new_post_count
    from public.get_my_group_new_post_counts()
    where group_id = '20000000-0000-0000-0000-000000000002'
  ),
  1::bigint,
  'a post newer than the shown list stays new'
);

select lives_ok(
  $$select public.mark_group_posts_visited(
    '20000000-0000-0000-0000-000000000002',
    statement_timestamp() - interval '2 hours'
  )$$,
  'an older shown list is accepted'
);
reset role;
select ok(
  (
    select posts_visited_at > now() - interval '45 minutes'
    from public.group_memberships
    where group_id = '20000000-0000-0000-0000-000000000002'
      and profile_id = (
        select id from public.profiles
        where auth_user_id = '10000000-0000-0000-0000-000000000001'
      )
  ),
  'an older watermark does not move it back'
);
set local role authenticated;

select lives_ok(
  $$select public.mark_group_posts_visited('20000000-0000-0000-0000-000000000002')$$,
  'clients without the watermark argument still mark the call time'
);
select is(
  (
    select new_post_count
    from public.get_my_group_new_post_counts()
    where group_id = '20000000-0000-0000-0000-000000000002'
  ),
  0::bigint,
  'the call-time watermark clears the new-post count'
);

select lives_ok(
  $$select public.mark_group_posts_visited(
    '20000000-0000-0000-0000-000000000002',
    statement_timestamp() + interval '1 day'
  )$$,
  'a future watermark is accepted'
);
reset role;
select ok(
  (
    select posts_visited_at <= statement_timestamp()
    from public.group_memberships
    where group_id = '20000000-0000-0000-0000-000000000002'
      and profile_id = (
        select id from public.profiles
        where auth_user_id = '10000000-0000-0000-0000-000000000001'
      )
  ),
  'server time caps the watermark'
);
set local role authenticated;
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
