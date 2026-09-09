begin;

create extension if not exists pgtap with schema extensions;
select plan(65);

-- 멘션 대상의 정본은 `public.post_mentions` / `public.comment_mentions`이고 본문에는 ordinal
-- 토큰만 남는다(기능 명세 §8.14). 이 파일은 그 둘이 어긋날 수 있는 자리를 전부 밟는다.

-- ---------------------------------------------------------------- 접근 경계
select is(
  (
    select count(*)::integer
    from (values ('public.post_mentions'), ('public.comment_mentions')) as target(name),
    (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as verb(privilege)
    where has_table_privilege('authenticated', target.name, verb.privilege)
  ),
  0,
  'mention rows are never readable or writable from the client'
);
select is(
  (
    select count(*)::integer
    from (values ('public.post_mentions'), ('public.comment_mentions')) as target(name),
    (values ('MAINTAIN'), ('REFERENCES'), ('TRIGGER'), ('TRUNCATE')) as verb(privilege)
    where has_table_privilege('authenticated', target.name, verb.privilege)
      or has_table_privilege('anon', target.name, verb.privilege)
  ),
  0,
  'default privileges are revoked from anon and authenticated'
);
select ok(
  to_regprocedure('public.update_group_post(uuid, text, text, uuid)') is null,
  'the second body write path is gone so mentions cannot drift from the body'
);

-- ---------------------------------------------------------------- 본문 파싱
select is(
  private.parse_mention_ordinals(
    '[@이한별](m:1) 님과 [@박새벽](m:10) 님, 다시 [@이한별](m:1) 님'
  ),
  array[1, 10]::smallint[],
  'ordinals are deduplicated and sorted'
);
select is(
  private.parse_mention_ordinals('멘션이 없는 본문 [링크](https://example.com)'),
  array[]::smallint[],
  'ordinary links are not mistaken for mentions'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

-- ---------------------------------------------------------------- 즉시 게시
select lives_ok(
  $$select public.create_group_post(
      '20000000-0000-0000-0000-000000000002', '발표 안내',
      '오늘 발표는 [@이한별](m:1) 님이 맡습니다.', 'identified', null, true,
      array['hanbyeol-25']
    )$$,
  'a member can mention another member of the same group'
);
reset role;
select is(
  (select array_agg(mention.profile_id order by mention.ordinal)
   from public.post_mentions as mention
   join public.posts as post on post.id = mention.post_id
   where post.title = '발표 안내'),
  array[4]::bigint[],
  'the body token resolves to the target profile id'
);

-- 본문에 pub_id 가 아니라 ordinal 만 남는다. 이것이 pub_id 변경·재사용에 안전한 이유다.
select ok(
  (select body from public.posts where title = '발표 안내') not like '%hanbyeol-25%',
  'the stored body carries no pub_id'
);

-- 읽기 RPC 는 저장된 이름이 아니라 지금 프로필의 이름을 돌려준다.
select is(
  (select (mention ->> 'name')
   from public.get_group_post((select id from public.posts where title = '발표 안내')) as detail,
   lateral jsonb_array_elements(detail.mentions) as mention),
  '이한별',
  'the read RPC resolves the display name from the profile, not the token'
);
select is(
  (select (mention ->> 'ordinal')::smallint
   from public.get_group_post((select id from public.posts where title = '발표 안내')) as detail,
   lateral jsonb_array_elements(detail.mentions) as mention),
  1::smallint,
  'the read RPC returns the ordinal the body token refers to'
);

set local role authenticated;

-- ---------------------------------------------------------------- 볼 수 없는 사람은 애초에 막는다
-- 김민준(032a49d61456)은 학교 공지 그룹에만 있고 이 그룹에는 없다. 그룹 밖 사람을 부르면
-- 그가 열 수 없는 글로 알림이 가고 칩은 갈 곳이 없다. 그래서 저장 자체를 막는다.
select throws_ok(
  $$select public.create_group_post(
      '20000000-0000-0000-0000-000000000002', '그룹 밖 멘션',
      '[@김민준](m:1) 님 보세요', 'identified', null, true, array['032a49d61456']
    )$$,
  '22023', 'every mention must name a current group member',
  'a non-member cannot be mentioned'
);
reset role;
select is(
  (select count(*)::integer from public.posts where title = '그룹 밖 멘션'),
  0,
  'the whole write is rolled back rather than dropping the mention silently'
);
set local role authenticated;
select throws_ok(
  $$select public.create_group_post(
      '20000000-0000-0000-0000-000000000002', '없는 사람',
      '[@없음](m:1)', 'identified', null, true, array['no-such-user']
    )$$,
  '22023', 'every mention must name a current group member',
  'an unknown pub_id cannot be mentioned'
);
-- 승인되지 않은 계정도 같은 문으로 막힌다.
select throws_ok(
  $$select public.create_group_post(
      '20000000-0000-0000-0000-000000000002', '대기 계정',
      '[@대기](m:1)', 'identified', null, true, array['pending-user']
    )$$,
  '22023', 'every mention must name a current group member',
  'a pending account cannot be mentioned'
);

-- 본문 토큰과 배열이 어긋나는 경우도 조용히 흘리지 않는다.
select throws_ok(
  $$select public.create_group_post(
      '20000000-0000-0000-0000-000000000002', '빈 자리',
      '[@이한별](m:2)', 'identified', null, true, array['hanbyeol-25']
    )$$,
  '22023', 'every mention must name a current group member',
  'a token whose ordinal has no entry fails'
);
select throws_ok(
  $$select public.create_group_post(
      '20000000-0000-0000-0000-000000000002', '상한 초과',
      '[@이한별](m:11)', 'identified', null, true,
      array['a','b','c','d','e','f','g','h','i','j','hanbyeol-25']
    )$$,
  '22023', 'a post can mention at most 10 members',
  'a post cannot mention more than ten members'
);

-- ---------------------------------------------------------------- 익명
select throws_ok(
  $$select public.create_group_post(
      '20000000-0000-0000-0000-000000000002', '익명 멘션',
      '[@이한별](m:1) 님', 'anonymous', null, true, array['hanbyeol-25']
    )$$,
  '42501', 'anonymous posts cannot mention members',
  'an anonymous post cannot mention anyone'
);
-- 운영진 명의는 실제 작성자의 이름과 사진을 그대로 보여주므로(기능 명세 §8.6) 막지 않는다.
select lives_ok(
  $$select public.create_group_post(
      '20000000-0000-0000-0000-000000000002', '운영진 멘션',
      '[@박새벽](m:1) 님 확인 바랍니다', 'staff', null, true, array['saebyeok-24']
    )$$,
  'a staff-identity post may mention members'
);

-- ---------------------------------------------------------------- 알림
reset role;
select is(
  (select count(*)::integer from public.notifications
   where kind = 'post_mentioned' and recipient_profile_id = 4),
  1,
  'the mentioned member receives exactly one notification'
);
select is(
  (select title from public.notifications
   where kind = 'post_mentioned' and recipient_profile_id = 4),
  '“발표 안내” 게시물에서 회원님을 멘션했습니다.',
  'the notification names the post it came from'
);
select is(
  (select importance::text from public.notifications
   where kind = 'post_mentioned' and recipient_profile_id = 4),
  'normal',
  'mentions are normal importance so Web Push is on by default'
);
select is(
  (select actor_display_name from public.notifications
   where kind = 'post_mentioned' and recipient_profile_id = 5
     and post_id = (select id from public.posts where title = '운영진 멘션')),
  '운영진',
  'a staff-identity mention shows the staff label as the actor'
);

-- ---------------------------------------------------------------- 제목 자르기
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.create_group_post(
      '20000000-0000-0000-0000-000000000002',
      '가나다라마바사아자차가나다라마바사아자차가나다라마바사아자차가나다라마바사아자차가나다라마바사아자차',
      '[@최푸름](m:1) 님', 'identified', null, true, array['pureum-23']
    )$$,
  'a long title is accepted'
);
reset role;
select is(
  (select title from public.notifications
   where kind = 'post_mentioned' and recipient_profile_id = 6),
  '“가나다라마바사아자차가나다라마바사아자차가나다라마바사아자차가나다라마바사아자…” 게시물에서 회원님을 멘션했습니다.',
  'a long post title is cut so the push title keeps its sentence'
);

-- ---------------------------------------------------------------- 수정
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

-- 멘션을 지웠다 다시 넣어도 같은 알림을 반복하지 않는다(기능 명세 §8.14).
select lives_ok(
  $$select public.commit_group_post(
      (select id from public.posts where title = '발표 안내'),
      '발표 안내', '멘션을 뺀 본문', null, false, null, array[]::text[]
    )$$,
  'an edit can drop every mention'
);
reset role;
select is(
  (select count(*)::integer from public.post_mentions as mention
   join public.posts as post on post.id = mention.post_id
   where post.title = '발표 안내'),
  0,
  'dropping the token drops the mention row'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.commit_group_post(
      (select id from public.posts where title = '발표 안내'),
      '발표 안내', '다시 [@이한별](m:1) 님', null, false, null, array['hanbyeol-25']
    )$$,
  'the same member can be mentioned again'
);
reset role;
select is(
  (select count(*)::integer from public.notifications
   where kind = 'post_mentioned' and recipient_profile_id = 4),
  1,
  're-adding the same mention does not notify twice'
);

-- 처음 등장한 사람에게는 새 알림이 간다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.commit_group_post(
      (select id from public.posts where title = '발표 안내'),
      '발표 안내', '[@이한별](m:1) 님과 [@박새벽](m:2) 님', null, false, null,
      array['hanbyeol-25', 'saebyeok-24']
    )$$,
  'an edit can add a new mention'
);
reset role;
select is(
  (select count(*)::integer from public.notifications
   where kind = 'post_mentioned' and recipient_profile_id = 5
     and post_id = (select id from public.posts where title = '발표 안내')),
  1,
  'only the newly added target is notified'
);

-- ---------------------------------------------------------------- 초안 → 게시
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.create_group_post(
      '20000000-0000-0000-0000-000000000002', '초안', '', 'identified', null, false
    )$$,
  'an unpublished draft is created'
);
select lives_ok(
  $$select public.commit_group_post(
      (select id from public.posts where title = '초안'),
      '초안', '[@최푸름](m:1) 님', null, false, null, array['pureum-23']
    )$$,
  'a draft can carry mentions before publication'
);
reset role;
select is(
  (select count(*)::integer from public.notifications
   where kind = 'post_mentioned' and recipient_profile_id = 6
     and post_id = (select id from public.posts where title = '초안')),
  0,
  'an unpublished draft notifies nobody'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.publish_group_post((select id from public.posts where title = '초안'))$$,
  'the draft is published'
);
reset role;
select is(
  (select count(*)::integer from public.notifications
   where kind = 'post_mentioned' and recipient_profile_id = 6
     and post_id = (select id from public.posts where title = '초안')),
  1,
  'publishing a draft notifies the members it already mentioned'
);

-- 멘션이 남아 있는 초안은 익명으로 바꿀 수 없다. 열어 두면 익명 금지가 통째로 우회된다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.create_group_post(
      '20000000-0000-0000-0000-000000000002', '신원 전환 초안', '', 'identified', null, false
    )$$,
  'a second draft is created'
);
select lives_ok(
  $$select public.commit_group_post(
      (select id from public.posts where title = '신원 전환 초안'),
      '신원 전환 초안', '[@이한별](m:1) 님', null, false, null, array['hanbyeol-25']
    )$$,
  'the draft carries a mention'
);
select throws_ok(
  $$select public.update_group_post_draft_identity(
      (select id from public.posts where title = '신원 전환 초안'), 'anonymous'
    )$$,
  '22023', 'remove mentions before switching a draft to anonymous',
  'a draft holding mentions cannot become anonymous'
);

-- ---------------------------------------------------------------- 댓글
select lives_ok(
  $$select public.create_post_comment(
      (select id from public.posts where title = '초안'), '[@박새벽](m:1) 님 보세요',
      'identified', null, null, array['saebyeok-24']
    )$$,
  'a comment can mention a member'
);
select throws_ok(
  $$select public.create_post_comment(
      (select id from public.posts where title = '초안'), '[@박새벽](m:1) 님',
      'anonymous', null, null, array['saebyeok-24']
    )$$,
  '42501', 'anonymous comments cannot mention members',
  'an anonymous comment cannot mention anyone'
);
select throws_ok(
  $$select public.create_post_comment(
      (select id from public.posts where title = '초안'), '[@김민준](m:1) 님',
      'identified', null, null, array['032a49d61456']
    )$$,
  '22023', 'every mention must name a current group member',
  'a comment cannot mention someone outside the group'
);
reset role;
select is(
  (select count(*)::integer from public.notifications
   where kind = 'comment_mentioned' and recipient_profile_id = 5),
  1,
  'the mentioned member is notified about the comment'
);
select is(
  (select title from public.notifications
   where kind = 'comment_mentioned' and recipient_profile_id = 5),
  '“초안” 게시물의 댓글에서 회원님을 멘션했습니다.',
  'a comment mention names the post the comment sits on'
);

-- ---------------------------------------------------------------- 댓글 알림과 겹치지 않는다
-- 이한별(4)의 글에 홍길동(1)이 댓글을 달면서 이한별을 부르면, 카드는 하나여야 한다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
values (
  '10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'hanbyeol@example.com', '', now()
);
update public.profiles set auth_user_id = '10000000-0000-0000-0000-000000000004' where id = 4;
set local role authenticated;
select lives_ok(
  $$select public.create_group_post(
      '20000000-0000-0000-0000-000000000002', '한별의 글', '본문', 'identified', null, true
    )$$,
  'the other member posts'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.create_post_comment(
      (select id from public.posts where title = '한별의 글'),
      '[@이한별](m:1) 님 확인 바랍니다', 'identified', null, null, array['hanbyeol-25']
    )$$,
  'a comment mentions the post author'
);
reset role;
select is(
  (select count(*)::integer from public.notifications
   where recipient_profile_id = 4
     and post_id = (select id from public.posts where title = '한별의 글')),
  1,
  'mentioning the post author in a comment yields one card, not two'
);
select is(
  (select kind::text from public.notifications
   where recipient_profile_id = 4
     and post_id = (select id from public.posts where title = '한별의 글')),
  'post_commented',
  'the comment notification wins and the mention is suppressed'
);

-- 답글도 같은 규칙을 따른다. 부모 댓글 작성자를 답글에서 부르면 답글 알림 하나만 남아야
-- 한다. 최상위 댓글과 코드는 같지만 수신자를 찾는 분기가 갈리므로 따로 밟는다.
--
-- `post_comments`에는 클라이언트 select grant 가 없어서 부모 댓글 ID 를 조회로 찾을 수 없다.
-- RPC 가 돌려주는 정본 행에서 받아 임시 표에 담는다(`post_attachments.test.sql`과 같은 방식).
reset role;
create temporary table mention_test_ids (name text primary key, id uuid not null);
grant select, insert on mention_test_ids to authenticated;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select lives_ok(
  $$insert into mention_test_ids
    select 'parent', entry.comment_id
    from public.create_post_comment(
      (select id from public.posts where title = '발표 안내'), '부모 댓글', 'identified'
    ) as entry$$,
  'the other member leaves a comment to reply to'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$insert into mention_test_ids
    select 'reply', entry.comment_id
    from public.create_post_comment(
      (select id from public.posts where title = '발표 안내'),
      '[@이한별](m:1) 님 답합니다', 'identified',
      (select id from mention_test_ids where name = 'parent'),
      null, array['hanbyeol-25']
    ) as entry$$,
  'a reply mentions the parent comment author'
);
reset role;
select is(
  (select count(*)::integer from public.notifications as notification
   where notification.recipient_profile_id = 4
     and notification.comment_id = (
       select id from mention_test_ids where name = 'reply'
     )),
  1,
  'mentioning the parent comment author in a reply yields one card, not two'
);
select is(
  (select notification.kind::text from public.notifications as notification
   where notification.recipient_profile_id = 4
     and notification.comment_id = (
       select id from mention_test_ids where name = 'reply'
     )),
  'comment_replied',
  'the reply notification wins and the mention is suppressed'
);

-- ---------------------------------------------------------------- 삭제
select isnt(
  (select count(*)::integer from public.comment_mentions as mention
   join public.post_comments as comment on comment.id = mention.comment_id
   where comment.post_id = (select id from public.posts where title = '초안')),
  0,
  'the post about to be deleted holds comment mentions'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.delete_group_post((select id from public.posts where title = '초안'))$$,
  'the author deletes the post'
);
reset role;
select is(
  (select count(*)::integer from public.post_mentions as mention
   where not exists (select 1 from public.posts as post where post.id = mention.post_id)),
  0,
  'deleting a post removes its mention rows'
);
select is(
  (select count(*)::integer from public.comment_mentions as mention
   where not exists (
     select 1 from public.post_comments as comment where comment.id = mention.comment_id
   )),
  0,
  'deleting a post removes the mention rows of its comments'
);

-- ---------------------------------------------------------------- 후보 검색
-- 정선생(9)을 그룹에 넣어 선생님이 먼저 오는지 본다.
insert into public.group_memberships (group_id, profile_id, role)
values ('20000000-0000-0000-0000-000000000002', 9, 'member');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(
  (select array_agg(candidate.name order by candidate.ordinality)
   from (
     select name, row_number() over () as ordinality
     from public.search_group_mention_candidates('20000000-0000-0000-0000-000000000002')
   ) as candidate),
  array['정선생', '홍길동', '이한별', '박새벽', '최푸름'],
  'teachers come first and students follow from the most recent cohort'
);
select is(
  (select array_agg(name) from public.search_group_mention_candidates(
     '20000000-0000-0000-0000-000000000002', '한별')),
  array['이한별'],
  'candidates can be searched by name'
);
select is(
  (select array_agg(name) from public.search_group_mention_candidates(
     '20000000-0000-0000-0000-000000000002', '23')),
  array['최푸름'],
  'candidates can be searched by the cohort shown on screen'
);
select is(
  (select array_agg(name) from public.search_group_mention_candidates(
     '20000000-0000-0000-0000-000000000002', '선생')),
  array['정선생'],
  'teachers are found by the label the screen shows'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select * from public.search_group_mention_candidates(
      '20000000-0000-0000-0000-000000000002')$$,
  '42501', 'group membership required',
  'a non-member cannot enumerate a group through the mention picker'
);
reset role;
set local role anon;
select throws_ok(
  $$select * from public.search_group_mention_candidates(
      '20000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'anonymous visitors cannot use the mention picker'
);
reset role;

-- ------------------------------------------------- 나간 멤버의 멘션은 글을 잠그지 않는다
-- 편집마다 본문의 모든 토큰에 멤버십을 다시 물으면, 멘션된 멤버가 그룹을 나간 뒤로 그 글이
-- 영구히 저장 불가가 된다 -- 제목 오타 하나도 못 고치고 작성자가 본문에서 토큰을 손으로 찾아
-- 지워야 한다. 이 묶음은 그 자리를 지킨다. 후보 검색 단언이 멤버 목록에 걸려 있으므로 멤버십을
-- 건드리는 이 검사를 맨 뒤에 둔다.
reset role;
delete from public.group_memberships
where group_id = '20000000-0000-0000-0000-000000000002' and profile_id = 5;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.commit_group_post(
      (select id from public.posts where title = '발표 안내'),
      '발표 안내', '[@이한별](m:1) 님과 [@박새벽](m:2) 님 확인 바랍니다',
      null, false, null, array['hanbyeol-25', 'saebyeok-24']
    )$$,
  'a post still saves after a mentioned member leaves the group'
);
reset role;
select is(
  (select count(*)::integer from public.post_mentions as mention
   join public.posts as post on post.id = mention.post_id
   where post.title = '발표 안내'),
  2,
  'the mention of the member who left is kept rather than dropped'
);

-- 새로 부르는 사람에게는 여전히 멤버십을 요구한다. 관대해진 것은 이미 불린 사람뿐이다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select public.commit_group_post(
      (select id from public.posts where title = '발표 안내'),
      '발표 안내', '[@김민준](m:1) 님', null, false, null, array['032a49d61456']
    )$$,
  '22023', 'every mention must name a current group member',
  'a brand-new mention still requires current membership'
);
reset role;

-- 댓글도 같은 규칙이다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.update_post_comment(
      (select id from mention_test_ids where name = 'reply'),
      '[@이한별](m:1) 님 답합니다 (수정)', null, false, array['hanbyeol-25']
    )$$,
  'a comment still saves when its mention target is still a member'
);
reset role;

select * from finish();
rollback;
