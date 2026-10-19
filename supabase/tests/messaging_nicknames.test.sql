begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

create temp table nickname_test_ids as
select
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001') as hong,
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000100') as minjun,
  (select id from public.profiles where pub_id = 'kim-admin') as outsider;
grant select on nickname_test_ids to authenticated;

create temp table nickname_test_chats (kind text primary key, id uuid);
grant all on nickname_test_chats to authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
insert into nickname_test_chats values
  ('direct', public.open_direct_conversation((select minjun from nickname_test_ids))),
  ('group', public.create_group_conversation('별명 검증방', array[(select minjun from nickname_test_ids)]));
reset role;

create temp table nickname_before as
select
  (select count(*) from private.notification_delivery_outbox) as deliveries,
  (select count(*) from private.messages) as messages;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select public.set_conversation_nickname((select id from nickname_test_chats where kind = 'direct'), (select minjun from nickname_test_ids), '  민준이  ')$$,
  'a current member sets a trimmed nickname in a direct chat'
);
select is(
  (select name from public.list_conversations((select id from nickname_test_chats where kind = 'direct'))),
  '민준이',
  'the direct chat title uses the counterpart nickname'
);
select ok(
  (select participants @> jsonb_build_array(jsonb_build_object(
    'id', (select minjun from nickname_test_ids), 'name', '민준이',
    'profile_name', '김민준', 'nickname', '민준이'
  )) from public.list_conversations((select id from nickname_test_chats where kind = 'direct'))),
  'chat participants expose both the nickname and the original profile name'
);
select is(
  (select name from public.list_conversations((select id from nickname_test_chats where kind = 'group'))),
  '별명 검증방',
  'a nickname does not rename another conversation'
);
select throws_ok(
  $$select public.set_conversation_nickname((select id from nickname_test_chats where kind = 'direct'), (select minjun from nickname_test_ids), repeat('가', 51))$$,
  '22023', null, 'nicknames longer than 50 characters are rejected'
);
select throws_ok(
  $$select public.set_conversation_nickname((select id from nickname_test_chats where kind = 'direct'), (select outsider from nickname_test_ids), '외부인')$$,
  '42501', null, 'a nickname cannot be set for someone outside the chat'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;
select ok(
  (select participants @> jsonb_build_array(jsonb_build_object('id', (select minjun from nickname_test_ids), 'name', '민준이'))
    from public.list_conversations((select id from nickname_test_chats where kind = 'direct'))),
  'another member sees the same nickname'
);
select lives_ok(
  $$select public.set_conversation_nickname((select id from nickname_test_chats where kind = 'direct'), (select minjun from nickname_test_ids), '   ')$$,
  'clearing a nickname restores the profile name'
);
select ok(
  (select participants @> jsonb_build_array(jsonb_build_object('id', (select minjun from nickname_test_ids), 'name', '김민준', 'nickname', null))
    from public.list_conversations((select id from nickname_test_chats where kind = 'direct'))),
  'a cleared nickname falls back to the original profile name'
);
select lives_ok(
  $$select public.set_conversation_nickname((select id from nickname_test_chats where kind = 'group'), (select hong from nickname_test_ids), '길동이')$$,
  'group chat members can also set nicknames'
);
reset role;

select is((select count(*) from private.notification_delivery_outbox),
  (select deliveries from nickname_before), 'nickname changes create no push deliveries');
select is((select count(*) from private.messages),
  (select messages from nickname_before), 'nickname changes create no messages or unread activity');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;
select public.send_message(
  (select id from nickname_test_chats where kind = 'group'),
  'e0000000-0000-0000-0000-000000000901', '[@홍길동](m:1) 확인',
  p_mention_pub_ids => array[(select pub_id from public.profiles where id = (select hong from nickname_test_ids))]
);
select is(
  (select last_message_body from public.list_conversations((select id from nickname_test_chats where kind = 'group'))),
  '@길동이 확인', 'conversation previews use the nickname shown in a mention'
);
select public.send_message(
  (select id from nickname_test_chats where kind = 'group'),
  'e0000000-0000-0000-0000-000000000902', '답장',
  p_reply_to_id => 'e0000000-0000-0000-0000-000000000901'
);
select is(
  (select reply_body from public.list_messages((select id from nickname_test_chats where kind = 'group'))
    where id = 'e0000000-0000-0000-0000-000000000902'),
  '@길동이 확인', 'reply previews use the nickname shown in a mention'
);
select is(
  jsonb_array_length(public.search_messages((select id from nickname_test_chats where kind = 'group'), '@길동이') -> 'results'),
  1, 'search finds the mention by the nickname displayed in the room'
);
reset role;
select is(
  (select body from private.message_push_content('e0000000-0000-0000-0000-000000000901', (select hong from nickname_test_ids), private.message_keys())),
  '김민준: @홍길동 확인', 'Push keeps original profile names even when room mentions use nicknames'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000099', true);
set local role authenticated;
select throws_ok(
  $$select public.set_conversation_nickname((select id from nickname_test_chats where kind = 'direct'), (select minjun from nickname_test_ids), '몰래 변경')$$,
  '42501', null, 'a nonmember cannot change chat nicknames'
);
reset role;

select * from finish();
rollback;
