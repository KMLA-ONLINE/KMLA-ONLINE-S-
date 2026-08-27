begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

-- 이 파일은 댓글 테이블의 경계와 CHECK만 본다. 댓글 RPC들의 grant는 `post_comments`가,
-- 그룹 게시물 RPC의 grant는 `group_posts`가 실제로 호출해 보며 증명한다 — 마이그레이션이
-- 반환 모양을 바꿔 함수를 다시 만들면 그쪽 호출이 42501로 먼저 깨진다.

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class
    where oid in (
      'public.post_comments'::regclass,
      'private.comment_authors'::regclass,
      'private.post_anonymous_aliases'::regclass
    )
      and not relrowsecurity
  ),
  0,
  'comments and their private author tables have RLS enabled'
);

-- 삭제된 댓글은 살아 있는 자손이 있을 때만 보여야 한다. 직접 select를 열면 그 판정을 건너뛰고
-- 삭제된 본문까지 읽히므로 읽기 권한조차 주지 않는다.
select is(
  (
    select count(*)::integer
    from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as verb(privilege)
    where has_table_privilege('authenticated', 'public.post_comments', verb.privilege)
  ),
  0,
  'comments are reachable only through the definer RPCs'
);

select is(
  (
    select count(*)::integer
    from (values
      ('private.comment_authors'), ('private.post_anonymous_aliases')
    ) as private_table(name),
    (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as verb(privilege)
    where has_table_privilege('authenticated', private_table.name, verb.privilege)
  ),
  0,
  'actual comment authors and anonymous alias assignments stay private'
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

-- 댓글 RPC는 전부 definer라 `anon`에게 한 번 새면 익명 댓글의 실제 작성자까지 샌다.
-- 이름으로 훑으므로 오버로드가 늘어도 따라온다.
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc as comment_function
    join pg_catalog.pg_namespace as schema
      on schema.oid = comment_function.pronamespace
    where schema.nspname = 'public'
      and comment_function.proname in (
        'list_post_comments', 'list_post_comment_replies',
        'create_post_comment', 'update_post_comment', 'delete_post_comment'
      )
      and has_function_privilege('anon', comment_function.oid, 'EXECUTE')
  ),
  0,
  'anonymous visitors cannot call any comment RPC'
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
