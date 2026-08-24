begin;

create extension if not exists pgtap with schema extensions;
select plan(46);

-- 시드에는 로그인 가능한 계정이 하나뿐이라 신원 정책과 운영 조치를 함께 볼 수 없다. 시드를
-- 건드리지 않고 트랜잭션 안에서만 두 계정을 더 붙인다.
--   auth1 = 시드 학생. 메이커스 랩 비멤버, 학교 공지의 일반 멤버
--   auth2 = kim-admin. 메이커스 랩 소유자
--   auth3 = hanbyeol-25. 메이커스 랩 멤버이자 익명 게시물의 실제 작성자
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'owner@kmla.hs.kr', '', now(),
    '', '', '', '', '', '', '', '', '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003',
    'authenticated', 'authenticated', 'writer@kmla.hs.kr', '', now(),
    '', '', '', '', '', '', '', '', '{}', '{}', now(), now()
  );

update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000000002'
where pub_id = 'kim-admin';
update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000000003'
where pub_id = 'hanbyeol-25';

-- 이 파일은 빈 스레드에서 시작하는 것을 전제로 번호와 개수를 센다. 시드가 넣어 둔 댓글은
-- 트랜잭션 안에서만 걷어낸다(파일 끝에서 통째로 롤백된다).
delete from public.post_comments;
delete from private.post_anonymous_aliases;

create temp table ids (name text primary key, id uuid);
grant select, insert on table ids to authenticated;

set local role anon;
select throws_ok(
  $$select * from public.list_post_comments('90000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'anonymous visitors cannot list comments'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$select * from public.list_post_comments('90000000-0000-0000-0000-000000000001')$$,
  '42501', 'group membership required', 'non-members cannot list comments'
);
select throws_ok(
  $$select * from public.create_post_comment(
      '90000000-0000-0000-0000-000000000001', '비멤버 댓글', 'identified'
    )$$,
  '42501', 'group membership required', 'non-members cannot comment'
);

-- 운영진 작성 그룹에서도 모든 멤버가 댓글을 남길 수 있다(기능 명세 §8.2).
select lives_ok(
  $$select * from public.create_post_comment(
      '90000000-0000-0000-0000-000000000003', '공지 잘 봤습니다.', 'identified'
    )$$,
  'staff-only posting policy does not restrict commenting'
);
select throws_ok(
  $$select * from public.create_post_comment(
      '90000000-0000-0000-0000-000000000003', '익명 시도', 'anonymous'
    )$$,
  '42501', 'anonymous commenting is not allowed', 'identified groups reject anonymous comments'
);
select throws_ok(
  $$select * from public.create_post_comment(
      '90000000-0000-0000-0000-000000000003', '운영진 사칭', 'staff'
    )$$,
  '42501', 'staff identity is not allowed', 'ordinary members cannot use the staff byline'
);
select throws_ok(
  $$select * from public.create_post_comment(
      '90000000-0000-0000-0000-000000000003', '   ', 'identified'
    )$$,
  '22023', 'comment requires a body or finalized image', 'blank comments are rejected'
);
select throws_ok(
  $$select * from public.create_post_comment(
      '90000000-0000-0000-0000-000000000003', repeat('가', 5001), 'identified'
    )$$,
  '22023', 'comment must contain between 1 and 5000 characters', 'overlong comments are rejected'
);
select throws_ok(
  $$insert into public.post_comments (
      id, post_id, root_comment_id, depth, body, author_identity, display_author_profile_id
    )
    values (
      '70000000-0000-0000-0000-0000000000aa', '90000000-0000-0000-0000-000000000003',
      '70000000-0000-0000-0000-0000000000aa', 0, '우회 댓글', 'identified', 1
    )$$,
  '42501', null, 'direct comment insertion is denied'
);
select is(
  (
    select comment_count
    from public.get_group_post('90000000-0000-0000-0000-000000000003')
  ),
  1,
  'creating a comment raises the denormalized count'
);

-- hanbyeol-25: 메이커스 랩 멤버, 익명 게시물 `...0002`의 실제 작성자.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

insert into ids
select 'root', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000001', '실명 최상위 댓글', 'identified'
);

select is(
  (select author_label from public.list_post_comments('90000000-0000-0000-0000-000000000001')),
  '이한별',
  'identified comments show the real name'
);
select is(
  (select depth from public.list_post_comments('90000000-0000-0000-0000-000000000001')),
  0::smallint,
  'top level comments have depth zero'
);
select throws_ok(
  $$select * from public.create_post_comment(
      '90000000-0000-0000-0000-000000000001', '운영진 사칭', 'staff'
    )$$,
  '42501', 'staff identity is not allowed', 'plain members cannot use the staff byline'
);

-- 익명 번호는 게시물 단위다. 실명 게시물에서는 이 사용자가 첫 익명 참여자다.
insert into ids
select 'anon_a', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000001', '익명으로 한마디', 'anonymous'
);
select is(
  (
    select author_label
    from public.list_post_comments('90000000-0000-0000-0000-000000000001')
    where comment_id = (select id from ids where name = 'anon_a')
  ),
  '익명1',
  'the first anonymous participant is numbered one'
);

insert into ids
select 'anon_a2', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000001', '익명으로 또 한마디', 'anonymous'
);
select is(
  (
    select author_label
    from public.list_post_comments('90000000-0000-0000-0000-000000000001')
    where comment_id = (select id from ids where name = 'anon_a2')
  ),
  '익명1',
  'the same participant keeps their number within a post'
);

-- 최상위 댓글은 오래된 페이지부터 시작해 커서 뒤의 최신 댓글로 이어진다.
reset role;
alter table public.post_comments disable trigger post_comments_prevent_immutable_changes;
update public.post_comments
set created_at = case id
  when (select id from ids where name = 'root') then '2026-08-23 01:00:00+00'::timestamptz
  when (select id from ids where name = 'anon_a') then '2026-08-23 02:00:00+00'::timestamptz
  when (select id from ids where name = 'anon_a2') then '2026-08-23 03:00:00+00'::timestamptz
  else created_at
end
where id in (
  (select id from ids where name = 'root'),
  (select id from ids where name = 'anon_a'),
  (select id from ids where name = 'anon_a2')
);
alter table public.post_comments enable trigger post_comments_prevent_immutable_changes;
set local role authenticated;

select is(
  (
    select array_agg(body order by created_at, comment_id)
    from public.list_post_comments(
      '90000000-0000-0000-0000-000000000001', p_limit => 2
    )
  ),
  array['실명 최상위 댓글', '익명으로 한마디']::text[],
  'the first comment page starts with the oldest comments'
);

with first_page as (
  select *
  from public.list_post_comments(
    '90000000-0000-0000-0000-000000000001', p_limit => 2
  )
), cursor_row as (
  select * from first_page order by created_at desc, comment_id desc limit 1
)
select is(
  (
    select array_agg(next_page.body order by next_page.created_at, next_page.comment_id)
    from cursor_row
    cross join lateral public.list_post_comments(
      '90000000-0000-0000-0000-000000000001',
      cursor_row.created_at,
      cursor_row.comment_id,
      2
    ) as next_page
  ),
  array['익명으로 또 한마디']::text[],
  'the comment cursor continues toward newer comments without overlap'
);

-- 익명 게시물의 실제 작성자가 익명으로 달면 `글쓴이`다(기능 명세 §9.3).
insert into ids
select 'author_note', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000002', '작성자입니다', 'anonymous'
);
select is(
  (select author_label from public.list_post_comments('90000000-0000-0000-0000-000000000002')),
  '글쓴이',
  'the anonymous post author is labelled as the writer'
);

-- 답글 중첩. 10단계를 채운 뒤 한 단계 더는 거부한다.
do $$
declare
  parent_id uuid;
  next_id uuid;
begin
  select id into parent_id from ids where name = 'root';
  for step in 1..10 loop
    select comment_id into next_id
    from public.create_post_comment(
      '90000000-0000-0000-0000-000000000001', '답글 ' || step, 'identified', parent_id
    );
    parent_id := next_id;
  end loop;
  insert into ids values ('deepest', parent_id);
end;
$$;

select is(
  (
    select depth
    from public.list_post_comment_replies((select id from ids where name = 'root'))
    where comment_id = (select id from ids where name = 'deepest')
  ),
  10::smallint,
  'replies nest up to ten levels'
);
select throws_ok(
  $$select * from public.create_post_comment(
      '90000000-0000-0000-0000-000000000001', '열한 번째', 'identified',
      (select id from ids where name = 'deepest')
    )$$,
  '22023', 'replies cannot nest deeper than 10 levels', 'the eleventh level is rejected'
);
select is(
  (
    select count(*)::integer
    from public.list_post_comment_replies((select id from ids where name = 'root'))
  ),
  10,
  'the reply bundle returns the whole subtree'
);
select is(
  (
    select reply_count
    from public.list_post_comments('90000000-0000-0000-0000-000000000001')
    where comment_id = (select id from ids where name = 'root')
  ),
  10,
  'top level comments carry their reply count'
);
select is(
  (
    select parent_author_label
    from public.list_post_comment_replies((select id from ids where name = 'root'))
    where depth = 1
  ),
  '이한별',
  'replies expose their parent author'
);
select throws_ok(
  $$select * from public.create_post_comment(
      '90000000-0000-0000-0000-000000000002', '남의 스레드에 답글', 'anonymous',
      (select id from ids where name = 'root')
    )$$,
  '22023', 'parent comment must belong to the post', 'replies cannot cross posts'
);

-- 수정은 작성자만.
select lives_ok(
  $$select * from public.update_post_comment(
      (select id from ids where name = 'root'), '고친 최상위 댓글'
    )$$,
  'authors can edit their own comment'
);
select is(
  (
    select body
    from public.list_post_comments('90000000-0000-0000-0000-000000000001')
    where comment_id = (select id from ids where name = 'root')
  ),
  '고친 최상위 댓글',
  'the edited body is returned'
);
select ok(
  (
    select edited_at is not null
    from public.list_post_comments('90000000-0000-0000-0000-000000000001')
    where comment_id = (select id from ids where name = 'root')
  ),
  'editing stamps the edit time'
);

-- 삭제된 답글은 살아 있는 자손이 있을 때만 남는다(기능 명세 §9.4).
select lives_ok(
  $$select public.delete_post_comment(
      (
        select comment_id
        from public.list_post_comment_replies((select id from ids where name = 'root'))
        where depth = 5
      )
    )$$,
  'a mid thread reply can be deleted'
);
select is(
  (
    select is_deleted
    from public.list_post_comment_replies((select id from ids where name = 'root'))
    where depth = 5
  ),
  true,
  'a deleted reply with living descendants stays as a tombstone'
);
select is(
  (
    select body
    from public.list_post_comment_replies((select id from ids where name = 'root'))
    where depth = 5
  ),
  '',
  'a tombstone hides its original body'
);
select is(
  (
    select author_label
    from public.list_post_comment_replies((select id from ids where name = 'root'))
    where depth = 5
  ),
  null::text,
  'a tombstone hides its author'
);
select isnt(
  (
    select parent_author_label
    from public.list_post_comment_replies((select id from ids where name = 'root'))
    where depth = 6
  ),
  null::text,
  'a reply keeps naming its parent after that parent is deleted'
);
select is(
  (
    select reply_count
    from public.list_post_comments('90000000-0000-0000-0000-000000000001')
    where comment_id = (select id from ids where name = 'root')
  ),
  9,
  'tombstones do not count as replies'
);

-- 마지막 자손까지 지우면 tombstone도 스스로 사라진다.
do $$
declare
  target uuid;
begin
  for step in reverse 10..6 loop
    select comment_id into target
    from public.list_post_comment_replies((select id from ids where name = 'root'))
    where depth = step;
    perform public.delete_post_comment(target);
  end loop;
end;
$$;

select is(
  (
    select count(*)::integer
    from public.list_post_comment_replies((select id from ids where name = 'root'))
  ),
  4,
  'a tombstone disappears once its last living descendant is gone'
);

-- kim-admin: 메이커스 랩 소유자.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

insert into ids
select 'anon_b', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000001', '소유자의 익명 댓글', 'anonymous'
);
select is(
  (
    select author_label
    from public.list_post_comments('90000000-0000-0000-0000-000000000001')
    where comment_id = (select id from ids where name = 'anon_b')
  ),
  '익명2',
  'the second anonymous participant is numbered two'
);

-- 같은 사용자가 다른 게시물에서는 다른 번호를 받는다. 번호로 사용자를 이을 수 없다.
insert into ids
select 'anon_b_other', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000002', '다른 글에서의 익명 댓글', 'anonymous'
);
select is(
  (
    select author_label
    from public.list_post_comments('90000000-0000-0000-0000-000000000002')
    where comment_id = (select id from ids where name = 'anon_b_other')
  ),
  '익명1',
  'anonymous numbers do not follow a user across posts'
);

select lives_ok(
  $$select * from public.create_post_comment(
      '90000000-0000-0000-0000-000000000001', '운영진 안내입니다', 'staff'
    )$$,
  'group staff can use the staff byline'
);
select throws_ok(
  $$select * from public.update_post_comment(
      (select id from ids where name = 'root'), '남의 댓글 고치기'
    )$$,
  '42501', 'only the author can edit a comment', 'moderators cannot edit other comments'
);
select lives_ok(
  $$select public.delete_post_comment((select id from ids where name = 'anon_a'))$$,
  'group owners can delete other members comments'
);

-- 최상위 댓글을 지우면 답글 묶음 전체가 사라진다.
select lives_ok(
  $$select public.delete_post_comment((select id from ids where name = 'root'))$$,
  'a top level comment can be deleted'
);
select is(
  (
    select count(*)::integer
    from public.list_post_comments('90000000-0000-0000-0000-000000000001')
    where comment_id = (select id from ids where name = 'root')
  ),
  0,
  'deleting a top level comment removes the thread'
);
select is(
  (
    select count(*)::integer
    from public.list_post_comment_replies((select id from ids where name = 'root'))
  ),
  0,
  'the replies of a deleted top level comment are hidden too'
);

-- 다른 멤버는 남의 댓글을 지울 수 없다.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select throws_ok(
  $$select public.delete_post_comment((select id from ids where name = 'anon_b'))$$,
  '42501', 'only the author or a group moderator can delete a comment',
  'ordinary members cannot delete other comments'
);

-- 선택 익명 그룹에서는 댓글마다 신원을 고를 수 있다.
insert into ids
select 'anon_group_post', public.create_group_post(
  '20000000-0000-0000-0000-000000000004', '익명 그룹 글', '본문입니다', 'anonymous'
);
select lives_ok(
  $$select * from public.create_post_comment(
      (select id from ids where name = 'anon_group_post'), '실명 시도', 'identified'
    )$$,
  'optional-anonymous groups accept identified comments'
);
select lives_ok(
  $$select * from public.create_post_comment(
      (select id from ids where name = 'anon_group_post'), '익명으로 남깁니다', 'anonymous'
    )$$,
  'optional-anonymous groups accept anonymous comments'
);

reset role;

select is(
  (select comment_count from public.posts where id = '90000000-0000-0000-0000-000000000001'),
  (
    select count(*)::integer
    from public.post_comments
    where post_id = '90000000-0000-0000-0000-000000000001' and deleted_at is null
  ),
  'the denormalized count matches the living comments'
);

select * from finish();
rollback;
