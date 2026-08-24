begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

-- 시드에는 로그인 가능한 계정이 하나뿐이라 여러 사람의 반응을 함께 볼 수 없다. 시드를 건드리지
-- 않고 트랜잭션 안에서만 두 계정을 더 붙인다.
--   auth1 = 시드 학생. 메이커스 랩 비멤버, 학교 공지의 일반 멤버
--   auth2 = kim-admin. 메이커스 랩 소유자
--   auth3 = hanbyeol-25. 메이커스 랩 멤버
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

-- 이 파일은 빈 상태에서 시작하는 것을 전제로 개수를 센다. 시드가 넣어 둔 반응은 트랜잭션
-- 안에서만 걷어낸다(파일 끝에서 통째로 롤백된다).
delete from public.post_reactions;
delete from public.comment_reactions;

set local role anon;
select throws_ok(
  $$select * from public.set_post_reaction(
      '90000000-0000-0000-0000-000000000003', 'like'
    )$$,
  '42501', null, 'anonymous visitors cannot react'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$select * from public.set_post_reaction(
      '90000000-0000-0000-0000-000000000001', 'like'
    )$$,
  '42501', 'group membership required', 'non-members cannot react to a post'
);
select throws_ok(
  $$select * from public.list_post_reactors('90000000-0000-0000-0000-000000000001')$$,
  '42501', 'group membership required', 'non-members cannot read the reactor list'
);
select throws_ok(
  $$insert into public.post_reactions (post_id, profile_id, reaction)
    values ('90000000-0000-0000-0000-000000000003', 1, 'like')$$,
  '42501', null, 'reactions cannot be written around the RPC'
);

-- 운영진 작성 그룹에서도 모든 멤버가 반응을 남길 수 있다(기능 명세 §8.2).
select is(
  (
    select reaction_count
    from public.set_post_reaction('90000000-0000-0000-0000-000000000003', 'like')
  ),
  1, 'staff-only posting policy does not restrict reacting'
);
select is(
  (
    select reaction_count
    from public.set_post_reaction('90000000-0000-0000-0000-000000000003', 'like')
  ),
  1, 'pressing the same reaction again still counts once'
);
select is(
  (
    select my_reaction
    from public.set_post_reaction('90000000-0000-0000-0000-000000000003', 'love')
  ),
  'love'::public.post_reaction, 'changing the kind replaces the reaction'
);
select is(
  (
    select reaction_count
    from public.set_post_reaction('90000000-0000-0000-0000-000000000003', 'love')
  ),
  1, 'changing the kind does not add a second reaction'
);
select is(
  (
    select reaction_count
    from public.clear_post_reaction('90000000-0000-0000-0000-000000000003')
  ),
  0, 'clearing removes the reaction'
);
select is(
  (
    select my_reaction
    from public.clear_post_reaction('90000000-0000-0000-0000-000000000003')
  ),
  null::public.post_reaction, 'clearing leaves nothing of my own'
);

select throws_ok(
  $$select * from public.set_post_reaction(
      '00000000-0000-0000-0000-0000000000ff', 'like'
    )$$,
  'P0002', 'post not found', 'reactions need a live post'
);

-- 여러 사람이 눌렀을 때의 집계. 메이커스 랩은 `optional_anonymous`라 반응은 실명으로 남는다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select set_post_reaction('90000000-0000-0000-0000-000000000001', 'love');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select set_post_reaction('90000000-0000-0000-0000-000000000001', 'like');

select is(
  (
    select reaction_count
    from public.get_group_post('90000000-0000-0000-0000-000000000001')
  ),
  2, 'the post detail counts everyone'
);
select is(
  (
    select my_reaction
    from public.get_group_post('90000000-0000-0000-0000-000000000001')
  ),
  'like'::public.post_reaction, 'the detail reports only the caller as my reaction'
);
select is(
  (
    select top_reactions
    from public.get_group_post('90000000-0000-0000-0000-000000000001')
  ),
  array['like', 'love']::public.post_reaction[],
  'ties in the top reactions break by enum order'
);
select is(
  (
    select count(*)::integer from public.list_post_reactors(
      '90000000-0000-0000-0000-000000000001'
    ) as reactor where reactor.reactor_pub_id is not null
  ),
  2, 'identified reactors each get their own row'
);
select is(
  (
    select reactor.reactor_name from public.list_post_reactors(
      '90000000-0000-0000-0000-000000000001'
    ) as reactor where reactor.reaction = 'love'
  ),
  '김관리', 'identified reactors are named'
);

-- 반응은 그룹 신원 정책과 무관하게 각 사용자를 한 행으로 내려준다.
select set_post_reaction('90000000-0000-0000-0000-000000000002', 'haha');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select set_post_reaction('90000000-0000-0000-0000-000000000002', 'haha');

select is(
  (
    select count(*)::integer from public.list_post_reactors(
      '90000000-0000-0000-0000-000000000002'
    )
  ),
  2, 'each reactor gets an individual row'
);
select ok(
  (
    select bool_and(reactor.reactor_pub_id is not null and reactor.reactor_name is not null)
    from public.list_post_reactors(
      '90000000-0000-0000-0000-000000000002'
    ) as reactor
  ),
  'reactors always expose normal profile presentation fields'
);

-- 댓글 반응 (기능 명세 §10.2).
select is(
  (
    select reaction_count
    from public.set_comment_reaction('a0000000-0000-0000-0000-000000000007', 'wow')
  ),
  1, 'members can react to a comment'
);
select is(
  (
    select comment.reaction_count
    from public.list_post_comments('90000000-0000-0000-0000-000000000001') as comment
    where comment.comment_id = 'a0000000-0000-0000-0000-000000000007'
  ),
  1, 'the comment list carries the reaction summary'
);
select is(
  (
    select reaction_count
    from public.clear_comment_reaction('a0000000-0000-0000-0000-000000000007')
  ),
  0, 'comment reactions can be taken back'
);

-- 삭제된 댓글은 자국만 남는다. 반응을 새로 붙일 수도, 남은 요약을 보여줄 수도 없다.
select set_comment_reaction('a0000000-0000-0000-0000-000000000002', 'sad');
reset role;
update public.post_comments set deleted_at = now()
where id = 'a0000000-0000-0000-0000-000000000002';
set local role authenticated;

select throws_ok(
  $$select * from public.set_comment_reaction(
      'a0000000-0000-0000-0000-000000000002', 'like'
    )$$,
  'P0002', 'comment not found', 'deleted comments cannot take new reactions'
);
select is(
  (
    select reply.reaction_count
    from public.list_post_comment_replies('a0000000-0000-0000-0000-000000000001') as reply
    where reply.comment_id = 'a0000000-0000-0000-0000-000000000002'
  ),
  0, 'a tombstone shows no reaction summary'
);

-- 댓글 반응 참여자 목록 (기능 명세 §10.3). 게시물과 같은 모양으로 내려온다.
select throws_ok(
  $$select * from public.list_comment_reactors(
      'a0000000-0000-0000-0000-000000000002'
    )$$,
  'P0002', 'comment not found', 'a tombstone has no reactor list to open'
);

select set_comment_reaction('a0000000-0000-0000-0000-000000000007', 'love');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select set_comment_reaction('a0000000-0000-0000-0000-000000000007', 'love');

select is(
  (
    select count(*)::integer from public.list_comment_reactors(
      'a0000000-0000-0000-0000-000000000007'
    ) as reactor where reactor.reactor_pub_id is not null
  ),
  2, 'comment reactors each get their own row'
);
select is(
  (
    select comment.top_reactions
    from public.list_post_comments('90000000-0000-0000-0000-000000000001') as comment
    where comment.comment_id = 'a0000000-0000-0000-0000-000000000007'
  ),
  array['love']::public.post_reaction[],
  'the comment summary reports the most used reaction'
);

reset role;
set local role anon;
select throws_ok(
  $$select * from public.list_comment_reactors(
      'a0000000-0000-0000-0000-000000000007'
    )$$,
  '42501', null, 'anonymous visitors cannot read comment reactors'
);
reset role;

select finish();
rollback;
