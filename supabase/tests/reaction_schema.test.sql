begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

-- 이 파일은 반응 테이블의 경계만 본다. 반응 RPC들의 grant는 `post_reactions`가 실제로
-- 호출해 보며 증명하므로 여기서 다시 나열하지 않는다 — 같은 사실을 두 번 적으면 한쪽만
-- 고쳐지는 일이 생긴다(`post_schema` 끝의 같은 주석 참고).

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class
    where oid in (
      'public.post_reactions'::regclass, 'public.comment_reactions'::regclass
    )
      and not relrowsecurity
  ),
  0,
  'both reaction tables have RLS enabled'
);

-- 반응 행은 통째로 신원이다. 읽기도 쓰기도 접근 권한을 확인하는 RPC로만 제공한다.
-- 동사를 하나씩 적는 대신 한자리에서 세면 새 권한이 새로 붙어도 여기서 걸린다.
select is(
  (
    select count(*)::integer
    from (values
      ('public.post_reactions'), ('public.comment_reactions')
    ) as reaction_table(name),
    (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as verb(privilege)
    where has_table_privilege('authenticated', reaction_table.name, verb.privilege)
  ),
  0,
  'reaction rows are reachable only through the definer RPCs'
);

select hasnt_column(
  'public', 'post_reactions', 'is_anonymous',
  'post reactions do not store an anonymity flag'
);
select hasnt_column(
  'public', 'comment_reactions', 'is_anonymous',
  'comment reactions do not store an anonymity flag'
);

-- 호출자를 인자로 받는 헬퍼라 클라이언트가 직접 부르면 남의 `my_reaction`을 읽거나 권한을
-- 사칭할 수 있다.
select is(
  (
    select count(*)::integer
    from (values
      ('private.post_reaction_summary(uuid, bigint)'),
      ('private.comment_reaction_summary(uuid, bigint)'),
      ('private.reaction_context(uuid, bigint)')
    ) as helper(signature)
    where has_function_privilege('authenticated', helper.signature, 'EXECUTE')
  ),
  0,
  'the caller-argument reaction helpers are not callable by clients'
);

-- `anon`에게는 어디에서도 grant하지 않지만, 반응 RPC는 definer라 한 번 새면 전부 샌다.
-- 이름으로 훑으므로 오버로드가 늘어도 따라온다.
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc as reaction_function
    join pg_catalog.pg_namespace as schema
      on schema.oid = reaction_function.pronamespace
    where schema.nspname = 'public'
      and reaction_function.proname in (
        'list_post_reactors', 'list_comment_reactors',
        'set_post_reaction', 'clear_post_reaction',
        'set_comment_reaction', 'clear_comment_reaction'
      )
      and has_function_privilege('anon', reaction_function.oid, 'EXECUTE')
  ),
  0,
  'anonymous visitors cannot call any reaction RPC'
);

select ok(
  (select prosecdef from pg_catalog.pg_proc
   where oid = 'public.list_post_reactors(uuid)'::regprocedure),
  'the post reactor list is a definer function'
);
select is(
  (select proconfig from pg_catalog.pg_proc
   where oid = 'public.list_post_reactors(uuid)'::regprocedure),
  array['search_path=""']::text[],
  'the post reactor list has an empty search path'
);
select ok(
  pg_catalog.array_position((
    select function.proargnames
    from pg_catalog.pg_proc as function
    where function.oid = 'public.list_post_reactors(uuid)'::regprocedure
  ), 'anonymous_count'::name) is null,
  'the post reactor result has no anonymous count'
);
select ok(
  pg_catalog.array_position((
    select function.proargnames
    from pg_catalog.pg_proc as function
    where function.oid = 'public.list_comment_reactors(uuid)'::regprocedure
  ), 'anonymous_count'::name) is null,
  'the comment reactor result has no anonymous count'
);

-- 한 사람이 한 대상에 남기는 반응은 하나다(기능 명세 §10.1, §10.2).
select col_is_pk(
  'public', 'post_reactions', array['post_id', 'profile_id'],
  'one reaction per person per post'
);
select col_is_pk(
  'public', 'comment_reactions', array['comment_id', 'profile_id'],
  'one reaction per person per comment'
);

select finish();
rollback;
