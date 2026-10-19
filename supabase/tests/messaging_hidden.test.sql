begin;

create extension if not exists pgtap with schema extensions;
select plan(13);

-- 대화 숨기기(기능 명세 §13.23). 숨긴 대화는 목록과 탭 배지에서 빠지고, 읽지 않은 수는 그대로 남는다.
-- 숨긴 뒤 메시지가 오면 다시 보인다.
-- seed: 홍길동(…0001)과 김민준(…0100)의 1:1 대화 c…01. 김민준의 메시지를 홍길동이 읽지 않은 상태로 둔다.

update public.conversation_members as member
set last_read_sent_at = '2000-01-01T00:00:00Z',
  last_read_message_id = '00000000-0000-0000-0000-000000000000'
from public.profiles as profile
where member.conversation_id = 'c0000000-0000-0000-0000-000000000001'
  and member.profile_id = profile.id
  and profile.auth_user_id = '10000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

create temp table before_hide as
select
  (select unread_count from public.list_conversations('c0000000-0000-0000-0000-000000000001')) as unread,
  public.get_my_unread_message_count() as badge;

select ok(
  (select unread > 0 from before_hide),
  'the fixture has unread messages from the other person'
);

select lives_ok(
  $$select public.set_conversation_hidden('c0000000-0000-0000-0000-000000000001', true)$$,
  'a member can hide a conversation'
);

select is(
  (select count(*) from public.list_conversations() where conversation_id = 'c0000000-0000-0000-0000-000000000001'),
  0::bigint,
  'a hidden conversation leaves my list'
);

select is(
  (select hidden from public.list_conversations('c0000000-0000-0000-0000-000000000001')),
  true,
  'the room still opens and says it is hidden'
);

select is(
  (select unread_count from public.list_conversations('c0000000-0000-0000-0000-000000000001')),
  (select unread from before_hide),
  'hiding keeps the unread messages unread'
);

select is(
  public.get_my_unread_message_count(),
  (select badge - unread from before_hide),
  'the tab badge leaves out a hidden conversation'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;

select is(
  (select count(*) from public.list_conversations() where conversation_id = 'c0000000-0000-0000-0000-000000000001'),
  1::bigint,
  'hiding does not touch the other member list'
);

select lives_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000001',
      'e2000000-0000-0000-0000-000000000001',
      '자니?'
    )$$,
  'the other member sends a new message'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is(
  (select hidden from public.list_conversations() where conversation_id = 'c0000000-0000-0000-0000-000000000001'),
  false,
  'a new message brings the conversation back'
);

select is(
  public.get_my_unread_message_count(),
  (select badge + 1 from before_hide),
  'the badge counts the earlier unread messages again along with the new one'
);

select lives_ok(
  $$select public.set_conversation_hidden('c0000000-0000-0000-0000-000000000001', true)$$,
  'a conversation can be hidden again'
);

select lives_ok(
  $$select public.set_conversation_hidden('c0000000-0000-0000-0000-000000000001', false)$$,
  'opening the room shows it again'
);

select throws_ok(
  $$select public.set_conversation_hidden('c0000000-0000-0000-0000-0000000000ff', true)$$,
  '42501',
  'conversation member required',
  'a conversation I am not in cannot be hidden'
);

select * from finish();
rollback;
