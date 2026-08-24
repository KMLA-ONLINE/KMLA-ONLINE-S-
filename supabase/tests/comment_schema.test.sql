begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.post_comments'::regclass),
  'post comments have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'private.comment_authors'::regclass),
  'private comment authors have RLS enabled'
);
select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'private.post_anonymous_aliases'::regclass
  ),
  'private anonymous aliases have RLS enabled'
);

-- 삭제된 댓글은 살아 있는 자손이 있을 때만 보여야 한다. 직접 select를 열면 그 판정을 건너뛰고
-- 삭제된 본문까지 읽히므로 읽기 권한조차 주지 않는다.
select ok(
  not has_table_privilege('authenticated', 'public.post_comments', 'SELECT'),
  'comments are only readable through definer RPCs'
);
select ok(
  not has_table_privilege('authenticated', 'public.post_comments', 'INSERT'),
  'authenticated cannot insert comments directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.post_comments', 'UPDATE'),
  'authenticated cannot update comments directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.post_comments', 'DELETE'),
  'authenticated cannot delete comments directly'
);
select ok(
  not has_table_privilege('authenticated', 'private.comment_authors', 'SELECT'),
  'actual comment authors remain private'
);
select ok(
  not has_table_privilege('authenticated', 'private.post_anonymous_aliases', 'SELECT'),
  'anonymous alias assignments remain private'
);

-- 호출자를 인자로 받는 집합 헬퍼라 클라이언트가 직접 부르면 권한을 사칭할 수 있다.
select ok(
  not has_function_privilege(
    'authenticated',
    'private.read_post_comments(uuid[],bigint,public.group_member_role)',
    'EXECUTE'
  ),
  'the shared comment read helper is not callable by clients'
);

select ok(
  has_function_privilege(
    'authenticated', 'public.list_post_comments(uuid,timestamptz,uuid,integer)', 'EXECUTE'
  ),
  'members can list comments'
);
select ok(
  has_function_privilege('authenticated', 'public.list_post_comment_replies(uuid)', 'EXECUTE'),
  'members can list replies'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.create_post_comment(uuid,text,public.post_identity,uuid,uuid)', 'EXECUTE'
  ),
  'members can create comments'
);
select ok(
  has_function_privilege('authenticated', 'public.update_post_comment(uuid,text,uuid,boolean)', 'EXECUTE'),
  'members can update comments'
);
select ok(
  has_function_privilege('authenticated', 'public.delete_post_comment(uuid)', 'EXECUTE'),
  'members can delete comments'
);
select ok(
  not has_function_privilege(
    'anon', 'public.create_post_comment(uuid,text,public.post_identity,uuid,uuid)', 'EXECUTE'
  ),
  'anonymous visitors cannot create comments'
);

-- 반환 모양이 바뀌어 다시 만든 두 RPC는 grant를 새로 발급해야 한다.
select ok(
  has_function_privilege(
    'authenticated',
    'public.list_group_posts(uuid,uuid,timestamptz,uuid,boolean,integer)',
    'EXECUTE'
  ),
  'recreated post list keeps its grant'
);
select ok(
  has_function_privilege('authenticated', 'public.get_group_post(uuid)', 'EXECUTE'),
  'recreated post detail keeps its grant'
);

select ok(
  to_regclass('public.post_comments_top_level_idx') is not null,
  'top level comments have a paging index'
);
select ok(
  to_regclass('public.post_comments_thread_idx') is not null,
  'reply bundles have a thread index'
);

-- 시드가 넣은 댓글까지 포함해 비정규화 카운트가 실제와 어긋난 게시물이 없어야 한다.
select is(
  (
    select count(*)::integer
    from public.posts as post
    where post.comment_count <> (
      select count(*)
      from public.post_comments as comment
      where comment.post_id = post.id and comment.deleted_at is null
    )
  ),
  0,
  'denormalized comment counts match the seeded threads'
);

-- 실제 부모와 어긋난 스레드 위치는 CHECK로 막는다. 나머지 무결성은 definer RPC가 책임진다.
select throws_ok(
  $$insert into public.post_comments (post_id, root_comment_id, depth, body, author_identity)
    values (
      '90000000-0000-0000-0000-000000000001',
      '90000000-0000-0000-0000-000000000001', 3, '깊이만 우긴 댓글', 'anonymous'
    )$$,
  '23514', null, 'a reply without a parent is rejected'
);
select throws_ok(
  $$insert into public.post_comments (
      id, post_id, root_comment_id, depth, body, author_identity, anon_alias_number
    )
    values (
      '70000000-0000-0000-0000-0000000000ff', '90000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-0000000000ff', 0, repeat('x', 5001), 'anonymous', 1
    )$$,
  '23514', null, 'the table still rejects an overlong comment body'
);
select throws_ok(
  $$insert into public.post_comments (
      id, post_id, root_comment_id, depth, body, author_identity
    )
    values (
      '70000000-0000-0000-0000-0000000000fe', '90000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-0000000000fe', 0, '익명 번호 없는 익명 댓글', 'anonymous'
    )$$,
  '23514', null, 'an anonymous comment without an alias number is rejected'
);

select * from finish();
rollback;
