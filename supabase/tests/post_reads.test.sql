begin;

create extension if not exists pgtap with schema extensions;
select plan(13);

-- Member of group 2 whose watermark sits an hour back; hanbyeol-25 is another member.
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
    '98000000-0000-0000-0000-000000000001', 'group', '다른 멤버의 새 글',
    '20000000-0000-0000-0000-000000000002', '새 글', 'anonymous',
    statement_timestamp() - interval '30 minutes', statement_timestamp() - interval '30 minutes'
  ),
  (
    '98000000-0000-0000-0000-000000000002', 'group', '다른 멤버의 또 다른 새 글',
    '20000000-0000-0000-0000-000000000002', '새 글 2', 'anonymous',
    statement_timestamp() - interval '20 minutes', statement_timestamp() - interval '20 minutes'
  ),
  (
    '98000000-0000-0000-0000-000000000003', 'group', '방문 전 글',
    '20000000-0000-0000-0000-000000000002', '예전 글', 'anonymous',
    statement_timestamp() - interval '2 hours', statement_timestamp() - interval '2 hours'
  ),
  (
    '98000000-0000-0000-0000-000000000004', 'group', '내 익명 글',
    '20000000-0000-0000-0000-000000000002', '내 글', 'anonymous',
    statement_timestamp() - interval '10 minutes', statement_timestamp() - interval '10 minutes'
  );

insert into private.post_authors (post_id, profile_id)
values
  (
    '98000000-0000-0000-0000-000000000001',
    (select id from public.profiles where pub_id = 'hanbyeol-25')
  ),
  (
    '98000000-0000-0000-0000-000000000002',
    (select id from public.profiles where pub_id = 'hanbyeol-25')
  ),
  (
    '98000000-0000-0000-0000-000000000003',
    (select id from public.profiles where pub_id = 'hanbyeol-25')
  ),
  (
    '98000000-0000-0000-0000-000000000004',
    (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001')
  );

select ok(
  has_function_privilege('authenticated', 'public.mark_post_read(uuid)', 'EXECUTE'),
  'authenticated can mark a post read'
);
select ok(
  not has_function_privilege('anon', 'public.mark_post_read(uuid)', 'EXECUTE'),
  'anonymous visitors cannot mark a post read'
);
select ok(
  not has_table_privilege('authenticated', 'private.post_reads', 'SELECT')
    and not has_table_privilege('anon', 'private.post_reads', 'SELECT'),
  'clients cannot read the post read records directly'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is(
  (
    select new_post_count
    from public.get_my_group_new_post_counts()
    where group_id = '20000000-0000-0000-0000-000000000002'
  ),
  2::bigint,
  'two posts from another member are new before any is opened'
);

select is(
  public.mark_post_read('98000000-0000-0000-0000-000000000001'),
  true,
  'opening a new post reports that the count dropped'
);
select is(
  (
    select new_post_count
    from public.get_my_group_new_post_counts()
    where group_id = '20000000-0000-0000-0000-000000000002'
  ),
  1::bigint,
  'an opened post leaves the group new-post count'
);
select is(
  public.mark_post_read('98000000-0000-0000-0000-000000000001'),
  false,
  'opening the same post again changes nothing'
);
select is(
  public.mark_post_read('98000000-0000-0000-0000-000000000003'),
  false,
  'a post the watermark already passed is not recorded'
);
select is(
  public.mark_post_read('98000000-0000-0000-0000-000000000004'),
  false,
  'the caller''s own post is not recorded'
);
select is(
  public.mark_post_read('98000000-0000-0000-0000-000000000099'),
  false,
  'a missing post is ignored'
);

select lives_ok(
  $$select public.mark_group_posts_visited(
    '20000000-0000-0000-0000-000000000002',
    statement_timestamp() - interval '25 minutes'
  )$$,
  'the list visit still records the watermark'
);
select is(
  (
    select new_post_count
    from public.get_my_group_new_post_counts()
    where group_id = '20000000-0000-0000-0000-000000000002'
  ),
  1::bigint,
  'a post newer than the shown list stays new after the opened one was read'
);

reset role;
select is(
  (
    select count(*)
    from private.post_reads
    where post_id = '98000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'the visit drops read records the watermark has passed'
);

select * from finish();
rollback;
