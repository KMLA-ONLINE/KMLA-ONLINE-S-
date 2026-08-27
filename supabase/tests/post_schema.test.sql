begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

-- 값이 늘어나도 생성된 TypeScript 유니온은 넓어질 뿐이라 컴파일은 통과한다. 신원 모델이
-- 소리 없이 하나 늘어나는 것을 여기서 잡는다(기능 명세 §8.5).
select is(
  array[
    enum_range(null::public.post_kind)::text,
    enum_range(null::public.post_identity)::text,
    enum_range(null::public.post_visibility)::text
  ],
  array['{group,profile}', '{identified,anonymous,staff}', '{public,private}'],
  'post kind, identity, and visibility values are fixed'
);

select is(
  (
    select allow_timeline_posts
    from public.profiles
    where auth_user_id = '10000000-0000-0000-0000-000000000001'
  ),
  true,
  'profiles allow timeline posts by default'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class
    where oid in (
      'public.posts'::regclass,
      'public.group_categories'::regclass,
      'private.post_authors'::regclass
    )
      and not relrowsecurity
  ),
  0,
  'posts, categories, and private post authors have RLS enabled'
);

insert into public.group_categories (id, group_id, name, position)
values
  (
    '60000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '공지',
    0
  ),
  (
    '60000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000003',
    '프로젝트',
    0
  );

select throws_ok(
  $$insert into public.group_categories (group_id, name, position)
    values (
      '20000000-0000-0000-0000-000000000001',
      ' 공지 ',
      1
    )$$,
  '23505',
  null,
  'category names are unique after trimming and case normalization'
);

select throws_ok(
  $$insert into public.group_categories (group_id, name, position)
    values (
      '20000000-0000-0000-0000-000000000001',
      '잘못된 순서',
      -1
    )$$,
  '23514',
  null,
  'category positions cannot be negative'
);

select lives_ok(
  $$insert into public.posts (
      id,
      kind,
      body,
      group_id,
      title,
      category_id,
      author_identity,
      display_author_profile_id,
      published_at
    ) values (
      '70000000-0000-0000-0000-000000000001',
      'group',
      E' 본문\n내용 ',
      '20000000-0000-0000-0000-000000000001',
      ' 검 색 ',
      '60000000-0000-0000-0000-000000000001',
      'identified',
      (select id from public.profiles
       where pub_id = 'kim-admin'),
      now()
    )$$,
  'an identified group post satisfies the common shape'
);

select is(
  (
    select body_format_version
    from public.posts
    where id = '70000000-0000-0000-0000-000000000001'
  ),
  1::smallint,
  'posts default to Markdown v1'
);

select throws_ok(
  $$insert into public.posts (
      kind,
      group_id,
      title,
      author_identity,
      body_format_version
    ) values (
      'group',
      '20000000-0000-0000-0000-000000000001',
      '지원하지 않는 본문 형식',
      'anonymous',
      2
    )$$,
  '23514',
  null,
  'unsupported post body format versions are rejected'
);

insert into private.post_authors (post_id, profile_id)
values (
  '70000000-0000-0000-0000-000000000001',
  (select id from public.profiles
   where pub_id = 'kim-admin')
);

select is(
  (
    select count(*)
    from private.post_authors
    where post_id = '70000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'the actual author is stored separately'
);

select lives_ok(
  $$insert into public.posts (
      id,
      kind,
      group_id,
      title,
      author_identity,
      published_at
    ) values (
      '70000000-0000-0000-0000-000000000002',
      'group',
      '20000000-0000-0000-0000-000000000004',
      '익명 게시물',
      'anonymous',
      now()
    )$$,
  'an anonymous group post does not expose its author'
);

select throws_ok(
  $$insert into public.posts (
      kind,
      group_id,
      title,
      author_identity,
      display_author_profile_id
    ) values (
      'group',
      '20000000-0000-0000-0000-000000000004',
      '작성자가 새는 익명 글',
      'anonymous',
      (select id from public.profiles
       where pub_id = 'hanbyeol-25')
    )$$,
  '23514',
  null,
  'anonymous posts cannot expose a profile id'
);

select lives_ok(
  $$insert into public.posts (
      id,
      kind,
      group_id,
      title,
      author_identity,
      published_at
    ) values (
      '70000000-0000-0000-0000-000000000003',
      'group',
      '20000000-0000-0000-0000-000000000005',
      '운영진 게시물',
      'staff',
      now()
    )$$,
  'a staff post uses no public author profile id'
);

select throws_ok(
  $$insert into public.posts (
      kind,
      group_id,
      author_identity
    ) values (
      'group',
      '20000000-0000-0000-0000-000000000001',
      'anonymous'
    )$$,
  '23514',
  null,
  'group posts require a title'
);

select throws_ok(
  $$insert into public.posts (
      kind,
      group_id,
      title,
      category_id,
      author_identity
    ) values (
      'group',
      '20000000-0000-0000-0000-000000000003',
      '다른 그룹 카테고리',
      '60000000-0000-0000-0000-000000000001',
      'anonymous'
    )$$,
  '23503',
  null,
  'posts cannot use a category from another group'
);

select lives_ok(
  $$insert into public.posts (
      id,
      kind,
      timeline_profile_id,
      author_identity,
      display_author_profile_id,
      visibility,
      published_at
    ) values (
      '70000000-0000-0000-0000-000000000004',
      'profile',
      (select id from public.profiles
       where pub_id = 'saebyeok-24'),
      'identified',
      (select id from public.profiles
       where pub_id = 'hanbyeol-25'),
      'public',
      now()
    )$$,
  'a public profile post may target another profile'
);

select lives_ok(
  $$insert into public.posts (
      id,
      kind,
      timeline_profile_id,
      author_identity,
      display_author_profile_id,
      visibility,
      published_at
    ) select
      '70000000-0000-0000-0000-000000000005',
      'profile',
      profile.id,
      'identified',
      profile.id,
      'private',
      now()
    from public.profiles as profile
     where profile.pub_id = 'hanbyeol-25'$$,
  'a private profile post may target its author'
);

-- 아래 읽기 검증은 인증 사용자가 붙어 있는 프로필로만 할 수 있다. 자기 비공개 글을
-- 스스로 읽는 경로를 확인하려면 그 사용자의 비공개 글이 하나 필요하다.
insert into public.posts (
  id,
  kind,
  timeline_profile_id,
  author_identity,
  display_author_profile_id,
  visibility,
  published_at
)
select
  '70000000-0000-0000-0000-000000000006',
  'profile',
  profile.id,
  'identified',
  profile.id,
  'private',
  now()
from public.profiles as profile
where profile.auth_user_id = '10000000-0000-0000-0000-000000000001';

-- 실제 쓰기 경로는 게시물과 작성자 행을 함께 넣는다. 읽기 정책이 작성자 판정을 거치므로
-- 여기서도 같이 넣어 준다.
insert into private.post_authors (post_id, profile_id)
select
  post.id,
  post.display_author_profile_id
from public.posts as post
where post.id in (
  '70000000-0000-0000-0000-000000000004',
  '70000000-0000-0000-0000-000000000005',
  '70000000-0000-0000-0000-000000000006'
);

select throws_ok(
  $$insert into public.posts (
      kind,
      timeline_profile_id,
      author_identity,
      display_author_profile_id,
      visibility
    ) values (
      'profile',
      (select id from public.profiles
       where pub_id = 'saebyeok-24'),
      'identified',
      (select id from public.profiles
       where pub_id = 'hanbyeol-25'),
      'private'
    )$$,
  '23514',
  null,
  'private profile posts require the author to own the timeline'
);

select throws_ok(
  $$insert into public.posts (
      kind,
      group_id,
      timeline_profile_id,
      title,
      author_identity,
      display_author_profile_id,
      visibility
    ) values (
      'profile',
      '20000000-0000-0000-0000-000000000001',
      (select id from public.profiles
       where pub_id = 'hanbyeol-25'),
      '개인 글 제목',
      'identified',
      (select id from public.profiles
       where pub_id = 'hanbyeol-25'),
      'public'
    )$$,
  '23514',
  null,
  'profile posts reject group-only fields'
);

select throws_ok(
  $$insert into public.posts (
      kind,
      body,
      group_id,
      title,
      author_identity
    ) values (
      'group',
      repeat('가', 20001),
      '20000000-0000-0000-0000-000000000001',
      '본문 제한',
      'anonymous'
    )$$,
  '23514',
  null,
  'post bodies are limited to 20000 characters'
);

select throws_ok(
  $$insert into public.posts (
      kind,
      group_id,
      title,
      author_identity
    ) values (
      'group',
      '20000000-0000-0000-0000-000000000001',
      repeat('가', 101),
      'anonymous'
    )$$,
  '23514',
  null,
  'group post titles are limited to 100 characters'
);

delete from public.group_categories
where id = '60000000-0000-0000-0000-000000000001';

select is(
  (
    select category_id
    from public.posts
    where id = '70000000-0000-0000-0000-000000000001'
  ),
  null::uuid,
  'deleting a category leaves its posts uncategorized'
);

select is(
  (
    select search_text
    from public.posts
    where id = '70000000-0000-0000-0000-000000000001'
  ),
  '검색본문내용',
  'group search text ignores whitespace'
);

set local role anon;

select throws_ok(
  $$select * from public.posts$$,
  '42501',
  null,
  'anonymous users cannot access posts'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

-- 그룹 글 3건 + 남의 타임라인에 달린 전체 공개 개인 글 1건 + 내 비공개 개인 글 1건
-- (기능 명세 §8.4, §12.4).
select is(
  (select count(*) from public.posts),
  5::bigint,
  'accepted users read group posts, public profile posts, and their own private ones'
);

select is(
  (
    select count(*)
    from public.posts
    where id = '70000000-0000-0000-0000-000000000005'
  ),
  0::bigint,
  'another user private profile post stays hidden'
);

select is(
  (
    select count(*)
    from public.posts
    where id = '70000000-0000-0000-0000-000000000006'
  ),
  1::bigint,
  'the author reads their own private profile post'
);

select throws_ok(
  $$select * from private.post_authors$$,
  '42501',
  null,
  'authenticated users cannot access actual post authors'
);

reset role;

-- grant 자체를 나열해 확인하는 것은 `group_posts`가 한다. 여기서는 바로 위에서 실제로
-- 실행해 본 것으로 충분하다 — 같은 사실을 두 번 적으면 한쪽만 고쳐지는 일이 생긴다.

select * from finish();
rollback;
