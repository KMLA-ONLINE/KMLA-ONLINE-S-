begin;

create extension if not exists pgtap with schema extensions;
select plan(32);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.post_reactions'::regclass),
  'post reactions have RLS enabled'
);
select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.comment_reactions'::regclass
  ),
  'comment reactions have RLS enabled'
);

-- 반응 행은 통째로 신원이다. 읽기는 접근 권한을 확인하는 RPC로만 제공한다.
select ok(
  not has_table_privilege('authenticated', 'public.post_reactions', 'SELECT'),
  'post reactions are only readable through definer RPCs'
);
select ok(
  not has_table_privilege('authenticated', 'public.post_reactions', 'INSERT'),
  'authenticated cannot insert post reactions directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.post_reactions', 'UPDATE'),
  'authenticated cannot update post reactions directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.post_reactions', 'DELETE'),
  'authenticated cannot delete post reactions directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.comment_reactions', 'SELECT'),
  'comment reactions are only readable through definer RPCs'
);
select ok(
  not has_table_privilege('authenticated', 'public.comment_reactions', 'INSERT'),
  'authenticated cannot insert comment reactions directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.comment_reactions', 'UPDATE'),
  'authenticated cannot update comment reactions directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.comment_reactions', 'DELETE'),
  'authenticated cannot delete comment reactions directly'
);
select hasnt_column(
  'public', 'post_reactions', 'is_anonymous',
  'post reactions do not store an anonymity flag'
);
select hasnt_column(
  'public', 'comment_reactions', 'is_anonymous',
  'comment reactions do not store an anonymity flag'
);

-- 호출자를 인자로 받는 헬퍼라 클라이언트가 직접 부르면 남의 `my_reaction`을 읽을 수 있다.
select ok(
  not has_function_privilege(
    'authenticated', 'private.post_reaction_summary(uuid, bigint)', 'EXECUTE'
  ),
  'the post reaction summary helper is not callable by clients'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.comment_reaction_summary(uuid, bigint)', 'EXECUTE'
  ),
  'the comment reaction summary helper is not callable by clients'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.reaction_context(uuid, bigint)', 'EXECUTE'
  ),
  'the reaction context helper is not callable by clients'
);

-- 반환 모양이 바뀌어 다시 만들어진 읽기 RPC들의 grant는 `comment_schema`가 한자리에서 센다.
-- 어느 마이그레이션이 다시 만들었든 확인할 것은 지금 DB의 상태 하나뿐이다.
select ok(
  has_function_privilege('authenticated', 'public.list_comment_reactors(uuid)', 'EXECUTE'),
  'the comment reactor list is callable by members'
);
select ok(
  not has_function_privilege('anon', 'public.list_post_reactors(uuid)', 'EXECUTE'),
  'anonymous visitors cannot call the post reactor list'
);
select ok(
  not has_function_privilege('anon', 'public.list_comment_reactors(uuid)', 'EXECUTE'),
  'anonymous visitors cannot call the comment reactor list'
);
select ok(
  has_function_privilege('authenticated', 'public.set_post_reaction(uuid,public.post_reaction)', 'EXECUTE'),
  'authenticated users can set post reactions'
);
select ok(
  not has_function_privilege('anon', 'public.set_post_reaction(uuid,public.post_reaction)', 'EXECUTE'),
  'anonymous visitors cannot set post reactions'
);
select ok(
  has_function_privilege('authenticated', 'public.clear_post_reaction(uuid)', 'EXECUTE'),
  'authenticated users can clear post reactions'
);
select ok(
  not has_function_privilege('anon', 'public.clear_post_reaction(uuid)', 'EXECUTE'),
  'anonymous visitors cannot clear post reactions'
);
select ok(
  has_function_privilege('authenticated', 'public.set_comment_reaction(uuid,public.post_reaction)', 'EXECUTE'),
  'authenticated users can set comment reactions'
);
select ok(
  not has_function_privilege('anon', 'public.set_comment_reaction(uuid,public.post_reaction)', 'EXECUTE'),
  'anonymous visitors cannot set comment reactions'
);
select ok(
  has_function_privilege('authenticated', 'public.clear_comment_reaction(uuid)', 'EXECUTE'),
  'authenticated users can clear comment reactions'
);
select ok(
  not has_function_privilege('anon', 'public.clear_comment_reaction(uuid)', 'EXECUTE'),
  'anonymous visitors cannot clear comment reactions'
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
