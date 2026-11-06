begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

-- 대화 고정(기능 명세 §13.2). 고정은 내 목록에서만 맨 위에 모이고, 숨기면 풀린다.
-- seed: 홍길동(…0001)은 김민준(…0100)과의 1:1 대화 c…01과 그룹 대화 c…02에 있다.

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is(
  (select count(*) from public.list_conversations() where pinned),
  0::bigint,
  'nothing is pinned to begin with'
);

select lives_ok(
  $$select public.set_conversation_pinned('c0000000-0000-0000-0000-000000000002', true)$$,
  'a member can pin a conversation'
);

select is(
  (select conversation_id from public.list_conversations() limit 1),
  'c0000000-0000-0000-0000-000000000002'::uuid,
  'a pinned conversation moves to the top of my list'
);

select is(
  (select pinned from public.list_conversations('c0000000-0000-0000-0000-000000000002')),
  true,
  'the room says it is pinned'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;

select is(
  (select pinned from public.list_conversations('c0000000-0000-0000-0000-000000000002')),
  false,
  'pinning does not touch the other member list'
);

select lives_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000001',
      'e2000000-0000-0000-0000-000000000011',
      '방금 보냄'
    )$$,
  'the other member sends a newer message in the direct chat'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is(
  (select conversation_id from public.list_conversations() limit 1),
  'c0000000-0000-0000-0000-000000000002'::uuid,
  'a pinned conversation stays above a chat with a newer message'
);

select lives_ok(
  $$select public.set_conversation_pinned('c0000000-0000-0000-0000-000000000002', false)$$,
  'a pin can be removed'
);

select is(
  (select conversation_id from public.list_conversations() limit 1),
  'c0000000-0000-0000-0000-000000000001'::uuid,
  'without the pin the newest chat leads again'
);

-- 숨기면 고정도 푼다. 숨긴 대화는 목록에 없으니 맨 위 자리를 들고 있을 이유가 없다.
select lives_ok(
  $$select public.set_conversation_pinned('c0000000-0000-0000-0000-000000000002', true);
    select public.set_conversation_hidden('c0000000-0000-0000-0000-000000000002', true)$$,
  'a pinned conversation can be hidden'
);

select is(
  (select pinned from public.list_conversations('c0000000-0000-0000-0000-000000000002')),
  false,
  'hiding clears the pin'
);

select throws_ok(
  $$select public.set_conversation_pinned('c0000000-0000-0000-0000-0000000000ff', true)$$,
  '42501',
  'conversation member required',
  'a conversation I am not in cannot be pinned'
);

select * from finish();
rollback;
