begin;

create extension if not exists pgtap with schema extensions;
select plan(51);

-- 아래 RPC들을 authenticated가 부를 수 있다는 사실은 이 파일이 실제로 호출해 보며 증명한다.
-- 여기서는 반대쪽 — 직접 쓰기와 익명 접근이 닫혀 있는지 — 만 한자리에서 센다.

select ok(has_table_privilege('authenticated', 'public.posts', 'SELECT'), 'authenticated can select member-visible posts');
select is(
  (
    select count(*)::integer
    from (values ('public.posts'), ('public.group_categories')) as target(name),
    (values ('INSERT'), ('UPDATE'), ('DELETE')) as verb(privilege)
    where has_table_privilege('authenticated', target.name, verb.privilege)
  ),
  0,
  'posts and categories are written only through the definer RPCs'
);
-- 테이블 UPDATE가 없어도 컬럼 단위로 새어 나갈 수 있다. 고정 상태는 운영진 판정을 지나야 한다.
select ok(not has_column_privilege('authenticated', 'public.posts', 'pinned_at', 'UPDATE'), 'authenticated cannot update pinned state directly');
-- 그룹 게시물 RPC는 전부 definer라 `anon`에게 한 번 새면 비공개 그룹 본문까지 샌다.
-- 이름으로 훑으므로 오버로드가 늘어도 따라온다.
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc as post_function
    join pg_catalog.pg_namespace as schema on schema.oid = post_function.pronamespace
    where schema.nspname = 'public'
      and post_function.proname in (
        'create_group_post', 'publish_group_post', 'commit_group_post',
        'move_group_category'
      )
      and has_function_privilege('anon', post_function.oid, 'EXECUTE')
  ),
  0,
  'anonymous visitors cannot call any group post RPC'
);
select ok(to_regprocedure('private.group_post_access(uuid)') is null, 'per-row private post access helper is removed');

set local role anon;
select throws_ok($$select * from public.posts$$, '42501', null, 'anonymous cannot read posts');
select throws_ok($$select * from public.list_group_posts('20000000-0000-0000-0000-000000000003')$$, '42501', null, 'anonymous cannot list group posts');
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is((select count(*) from public.posts), 1::bigint, 'member SELECT RLS exposes only posts in joined groups');
select is((select count(*) from public.group_categories), 1::bigint, 'category SELECT RLS exposes only joined groups');
select throws_ok(
  $$insert into public.posts (kind, body, group_id, title, author_identity, published_at)
    values ('group', '우회 본문', '20000000-0000-0000-0000-000000000002', '우회', 'identified', now())$$,
  '42501', null, 'direct post creation is denied'
);
select throws_ok(
  $$select public.create_group_category('20000000-0000-0000-0000-000000000001', '권한 없음', 9)$$,
  '42501', 'category mutation is not allowed', 'ordinary members cannot mutate categories'
);
select throws_ok(
  $$select * from public.move_group_category('80000000-0000-0000-0000-000000000001', 1::smallint)$$,
  '42501', 'category mutation is not allowed', 'ordinary members cannot move categories'
);
select throws_ok(
  $$select * from public.list_group_posts('20000000-0000-0000-0000-000000000003')$$,
  '42501', 'group membership required', 'non-members cannot use the definer post list'
);
select throws_ok(
  $$select * from public.get_group_post('90000000-0000-0000-0000-000000000001')$$,
  '42501', 'group membership required', 'non-members cannot use the definer post detail'
);
select throws_ok(
  $$select * from public.search_group_posts('20000000-0000-0000-0000-000000000003', '프로젝트', 50)$$,
  '42501', 'group membership required', 'non-members cannot use the definer post search'
);
select throws_ok(
  $$select public.create_group_post('20000000-0000-0000-0000-000000000001', '공지 우회', '본문', 'identified', null)$$,
  '42501', 'group posting is restricted to staff', 'staff-only posting policy is enforced'
);
select throws_ok(
  $$select public.create_group_post('20000000-0000-0000-0000-000000000002', '제목', '   ', 'anonymous', null)$$,
  '22023', 'published post requires a body or ready attachment', 'immediate publishing requires content'
);
select throws_ok(
  $$select public.create_group_post('20000000-0000-0000-0000-000000000001', '제목', '본문', 'staff', null)$$,
  '42501', 'group posting is restricted to staff', 'ordinary members cannot use staff identity'
);
select throws_ok(
  $$select public.create_group_post('20000000-0000-0000-0000-000000000001', '익명 우회', '본문', 'anonymous', null)$$,
  '42501', 'group posting is restricted to staff', 'posting policy is checked before identity policy'
);

select lives_ok(
  $$select public.create_group_post('20000000-0000-0000-0000-000000000002', '익명 글', '비공개 그룹 본문', 'anonymous', null)$$,
  'member can atomically create an allowed anonymous post'
);
select lives_ok(
  $$select public.create_group_post('20000000-0000-0000-0000-000000000002', '익명 초안', '초안 본문', 'anonymous', null, false)$$,
  'member can create an anonymous draft while the policy allows it'
);
reset role;
update public.groups set identity_policy = 'identified'
where id = '20000000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok(
  $$select public.create_group_post(
      '20000000-0000-0000-0000-000000000002', '익명 생성 우회', '본문', 'anonymous', null
    )$$,
  '42501', 'anonymous posting is not allowed',
  'identified groups reject anonymous post creation'
);
select lives_ok(
  $$select public.create_group_post(
      '20000000-0000-0000-0000-000000000002', '실명 글', '본문', 'identified', null
    )$$,
  'identified groups accept identified post creation'
);
select throws_ok(
  $$select public.commit_group_post(
      (select id from public.posts where title = '익명 초안'), '익명 초안', '초안 본문', '{}', true, null
    )$$,
  '42501', 'anonymous posting is not allowed',
  'commit rechecks the current identity policy before publishing a draft'
);
select throws_ok(
  $$select public.publish_group_post((select id from public.posts where title = '익명 초안'))$$,
  '42501', 'anonymous posting is not allowed',
  'the standalone publish path also rechecks the current identity policy'
);
reset role;
update public.groups set identity_policy = 'optional_anonymous'
where id = '20000000-0000-0000-0000-000000000002';
update public.groups set posting_policy = 'members'
where id = '20000000-0000-0000-0000-000000000001';
set local role authenticated;
select lives_ok(
  $$select public.create_group_post(
      '20000000-0000-0000-0000-000000000001', '정책 변경 초안', '초안 본문', 'identified', null, false
    )$$,
  'member can create a draft while member posting is allowed'
);
reset role;
update public.groups set posting_policy = 'staff'
where id = '20000000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok(
  $$select public.commit_group_post(
      (select id from public.posts where title = '정책 변경 초안'),
      '정책 변경 초안', '초안 본문', '{}', true, null
    )$$,
  '42501', 'group posting is restricted to staff',
  'commit rechecks the current posting policy before publishing a draft'
);
select is(
  (select author_label from public.list_group_posts('20000000-0000-0000-0000-000000000002') where title = '익명 글'),
  '익명', 'anonymous response uses a safe label'
);
select is(
  (select author_pub_id from public.list_group_posts('20000000-0000-0000-0000-000000000002') where title = '익명 글'),
  null::text, 'anonymous response never exposes actual identity'
);
select ok(
  (select is_author from public.list_group_posts('20000000-0000-0000-0000-000000000002') where title = '익명 글'),
  'anonymous author still receives self-only controls'
);
select lives_ok(
  $$select public.update_group_post(
      (select id from public.posts where title = '익명 글'), '수정된 익명 글', '수정 본문', null
    )$$,
  'author can update title and body without changing identity'
);
select throws_ok(
  $$update public.posts set author_identity = 'identified' where title = '수정된 익명 글'$$,
  '42501', null, 'direct immutable-field updates remain denied'
);
reset role;

select throws_ok(
  $$update public.posts set author_identity = 'identified' where id = '90000000-0000-0000-0000-000000000002'$$,
  '55000', 'post identity and publication fields cannot be changed',
  'immutable post fields are protected even from privileged writes'
);

insert into public.group_memberships (group_id, profile_id, role)
values (
  '20000000-0000-0000-0000-000000000003',
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001'),
  'manager'
);
set local role authenticated;

select throws_ok(
  $$insert into public.group_categories (group_id, name, position)
    values ('20000000-0000-0000-0000-000000000003', '직접 우회', 8)$$,
  '42501', null, 'manager cannot bypass category RPCs with a direct write'
);
select lives_ok(
  $$select public.create_group_category('20000000-0000-0000-0000-000000000003', '새 분류', null)$$,
  'manager can create a category through the RPC'
);
select lives_ok(
  $$select public.update_group_category((select id from public.group_categories where name = '새 분류'), '새 이름', 2)$$,
  'manager can rename and reorder a category'
);
select lives_ok(
  $$select public.create_group_category('20000000-0000-0000-0000-000000000003', '뒤 분류', 3)$$,
  'manager can append another category'
);
select lives_ok(
  $$select * from public.move_group_category(
    (select id from public.group_categories where name = '뒤 분류'), -1::smallint
  )$$,
  'manager can atomically move a category by deterministic order'
);
select is(
  (select array_agg(name order by position, id)
   from public.group_categories
   where group_id = '20000000-0000-0000-0000-000000000003'),
  array['제작', '질문', '뒤 분류', '새 이름']::text[],
  'move swaps with the adjacent category and normalizes positions'
);
select is(
  (select array_agg(position order by position, id)
   from public.group_categories
   where group_id = '20000000-0000-0000-0000-000000000003'),
  array[0, 1, 2, 3]::integer[],
  'atomic move leaves a contiguous category order'
);
select lives_ok(
  $$select public.create_group_post('20000000-0000-0000-0000-000000000003', '운영진 글', '운영진 본문', 'staff', null)$$,
  'manager can post with the staff identity'
);
select lives_ok(
  $$select public.create_group_post('20000000-0000-0000-0000-000000000003', '운영진 초안', '초안 본문', 'staff', null, false)$$,
  'manager can create a staff draft'
);
reset role;
update public.group_memberships
set role = 'member'
where group_id = '20000000-0000-0000-0000-000000000003'
  and profile_id = (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.commit_group_post(
      (select id from public.posts where title = '운영진 초안'), '운영진 초안', '초안 본문', '{}', true, null
    )$$,
  '42501', 'staff identity is not allowed',
  'commit rechecks the current member role before publishing a staff draft'
);
reset role;
update public.group_memberships
set role = 'manager'
where group_id = '20000000-0000-0000-0000-000000000003'
  and profile_id = (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001');
set local role authenticated;
select is(
  (select author_label from public.get_group_post((select id from public.posts where title = '운영진 글'))),
  '운영진', 'staff response uses the staff label'
);
select isnt(
  (select author_pub_id from public.get_group_post((select id from public.posts where title = '운영진 글'))),
  null::text,
  'staff response exposes the author profile link'
);
select is(
  (select author_name from public.get_group_post((select id from public.posts where title = '운영진 글'))),
  '홍길동',
  'staff response uses the author profile name'
);
select lives_ok(
  $$select public.set_group_post_pinned((select id from public.posts where title = '운영진 글'), true)$$,
  'manager can pin a post'
);
select is(
  (select title from public.list_group_posts('20000000-0000-0000-0000-000000000003') limit 1),
  '운영진 글', 'first page places pinned posts first'
);
select is(
  (select count(*) from public.list_group_posts(
    '20000000-0000-0000-0000-000000000003', null, '2026-08-13 03:00:00+00', '90000000-0000-0000-0000-000000000003', false, 20
  ) where is_pinned),
  0::bigint, 'cursor pages do not repeat pinned posts'
);
select is(
  (select count(*) from public.search_group_posts('20000000-0000-0000-0000-000000000003', '프로 젝트', 100)),
  1::bigint, 'search ignores whitespace and clamps its maximum limit'
);

select lives_ok(
  $$select public.delete_group_category((select id from public.group_categories where name = '새 이름'))$$,
  'manager can delete a category'
);

reset role;
select * from finish();
rollback;
