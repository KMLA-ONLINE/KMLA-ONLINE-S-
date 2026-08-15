begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

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

-- 반응 행은 통째로 신원이다. 직접 select를 열면 익명 반응자의 `profile_id`가 그대로 읽힌다.
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

-- 읽기 RPC는 반환 모양이 바뀌어 다시 만들어졌다. grant를 다시 발급하지 않으면 런타임에서
-- 42501로 터진다.
select ok(
  has_function_privilege(
    'authenticated',
    'public.list_group_posts(uuid, uuid, timestamptz, uuid, boolean, integer)',
    'EXECUTE'
  ),
  'the recreated post list keeps its grant'
);
select ok(
  has_function_privilege('authenticated', 'public.get_group_post(uuid)', 'EXECUTE'),
  'the recreated post detail keeps its grant'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.list_post_comments(uuid, timestamptz, uuid, integer)', 'EXECUTE'
  ),
  'the recreated comment list keeps its grant'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.create_post_comment(uuid, text, public.post_identity, uuid)', 'EXECUTE'
  ),
  'the recreated comment writer keeps its grant'
);

select ok(
  has_function_privilege('authenticated', 'public.list_comment_reactors(uuid)', 'EXECUTE'),
  'the comment reactor list is callable by members'
);

-- 한 사람이 한 게시물에 남기는 반응은 하나다(기능 명세 §10.1).
select col_is_pk(
  'public', 'post_reactions', array['post_id', 'profile_id'],
  'one reaction per person per post'
);

select finish();
rollback;
