begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

-- seed: 홍길동(…0001)과 김민준(…0100)의 1:1 대화 c…01, 둘과 박새벽·이한별의 그룹 대화 c…02.
create temp table people as
select
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001') as hong,
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000100') as minjun,
  (select pub_id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000100') as minjun_pub,
  (select id from public.profiles where pub_id = 'kim-admin') as admin,
  (select id from public.profiles where pub_id = 'saebyeok-24') as saebyeok;
grant select on people to authenticated;

-- 그룹 c…02의 별명 시스템 메시지를 오래된 것부터.
create function pg_temp.nickname_events()
returns table (kind text, profile_ids bigint[], name text)
language sql
as $$
  select message.system_kind, message.system_profile_ids, message.system_name
  from private.messages as message
  where message.conversation_id = 'c0000000-0000-0000-0000-000000000002'
    and message.system_kind like 'nickname_%'
  order by message.sent_at, message.id;
$$;

-- 대화 목록이 내려 주는 한 사람의 별명.
create function pg_temp.nickname_of(p_profile_id bigint)
returns text
language sql
as $$
  select participant ->> 'nickname'
  from public.list_conversations('c0000000-0000-0000-0000-000000000002') as conversation,
    jsonb_array_elements(conversation.participants) as participant
  where (participant ->> 'id')::bigint = p_profile_id;
$$;
grant execute on function pg_temp.nickname_of(bigint) to authenticated;

select ok(
  has_function_privilege('authenticated', 'public.set_conversation_nickname(uuid, bigint, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.set_conversation_nickname(uuid, bigint, text)', 'EXECUTE')
    and not has_table_privilege('authenticated', 'private.conversation_nicknames', 'SELECT')
    and not has_function_privilege('authenticated', 'private.message_plain_text(text)', 'EXECUTE'),
  'only signed-in members set nicknames, and only through the RPC'
);

-- 다른 멤버의 별명

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select public.set_conversation_nickname(
  'c0000000-0000-0000-0000-000000000002', (select minjun from people), '  준이  '
);
select public.set_conversation_nickname(
  'c0000000-0000-0000-0000-000000000002', (select minjun from people), '준이'
);

select is(
  pg_temp.nickname_of((select minjun from people)),
  '준이',
  'a member can give another member a trimmed nickname'
);

-- 화면은 후보 목록에 보이던 별명을 토큰 글자로 보낸다.
select public.send_message(
  'c0000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000901',
  '[@준이](m:1) 자료 봐 줘',
  p_mention_pub_ids => array[(select minjun_pub from people)]
);

reset role;

-- 민준이 그 메시지에 반응하고 답한다. 반응 목록과 Push가 별명을 쓴다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;
select public.set_message_reaction('e0000000-0000-0000-0000-000000000901', 'like');
select public.send_message(
  'c0000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000902',
  '봤어'
);
select is(
  (select name from public.list_message_reactors('e0000000-0000-0000-0000-000000000901')),
  '준이',
  'the reactor list names people by nickname'
);
reset role;

select is(
  (
    select body
    from private.message_push_content(
      'e0000000-0000-0000-0000-000000000902', (select hong from people), private.message_keys()
    )
  ),
  '준이: 봤어',
  'a group push names the sender by nickname'
);

select results_eq(
  $$select kind, profile_ids, name from pg_temp.nickname_events()$$,
  $$values ('nickname_set', array[(select hong from people), (select minjun from people)], '준이')$$,
  'setting a nickname leaves one system message, and resetting the same nickname leaves none'
);

-- 다른 멤버도 보고, 별명을 지운다

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;

select is(
  pg_temp.nickname_of((select minjun from people)),
  '준이',
  'every member sees the nickname'
);

select public.set_conversation_nickname(
  'c0000000-0000-0000-0000-000000000002', (select minjun from people), '   '
);

select is(
  pg_temp.nickname_of((select minjun from people)),
  null,
  'a blank nickname clears it'
);

select public.set_conversation_nickname(
  'c0000000-0000-0000-0000-000000000002', (select minjun from people), '민준이형'
);

reset role;

-- 별명이 바뀌어도 멘션은 보낼 때의 글자 그대로다(기능 명세 §13.22).
select is(
  (
    public.search_messages('c0000000-0000-0000-0000-000000000002', '@준이')
      -> 'results' -> 0 ->> 'body'
  ),
  '@준이 자료 봐 줘',
  'a mention keeps the nickname it was sent with after the nickname changes'
);

select results_eq(
  $$select kind, profile_ids, name from pg_temp.nickname_events()$$,
  $$values
    ('nickname_set', array[(select hong from people), (select minjun from people)], '준이'),
    ('nickname_cleared', array[(select minjun from people), (select minjun from people)], null),
    ('nickname_set', array[(select minjun from people), (select minjun from people)], '민준이형')$$,
  'clearing and setting my own nickname are recorded too'
);

-- 거부

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$select public.set_conversation_nickname(
    'c0000000-0000-0000-0000-000000000002', (select minjun from people), repeat('가', 21)
  )$$,
  '22023',
  null,
  'a nickname is at most 20 characters'
);

select throws_ok(
  $$select public.set_conversation_nickname(
    'c0000000-0000-0000-0000-000000000002', (select minjun from people), E'줄\n바꿈'
  )$$,
  '22023',
  null,
  'a nickname has no control characters'
);

select throws_ok(
  $$select public.set_conversation_nickname(
    'c0000000-0000-0000-0000-000000000002', (select minjun from people), chr(12644) || chr(8203)
  )$$,
  '22023',
  null,
  'a nickname needs a visible character'
);

select throws_ok(
  $$select public.set_conversation_nickname(
    'c0000000-0000-0000-0000-000000000002', (select minjun from people), '준' || chr(8238) || '이'
  )$$,
  '22023',
  null,
  'a nickname cannot reverse text direction'
);

select throws_ok(
  $$select public.set_conversation_nickname(
    'c0000000-0000-0000-0000-000000000002', (select admin from people), '관리자'
  )$$,
  '22023',
  null,
  'only a current member can get a nickname'
);

select throws_ok(
  $$select public.set_conversation_nickname(
    'c0000000-0000-0000-0000-000000000001', (select minjun from people), '준이'
  )$$,
  '42501',
  null,
  'direct conversations have no nicknames'
);

reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select public.leave_conversation('c0000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select public.set_conversation_nickname(
    'c0000000-0000-0000-0000-000000000002', (select minjun from people), '준이'
  )$$,
  '42501',
  null,
  'a member who left cannot set nicknames'
);

reset role;

select throws_ok(
  $$insert into private.conversation_nicknames (conversation_id, profile_id, nickname)
    values ('c0000000-0000-0000-0000-000000000002', (select minjun from people), chr(12288))$$,
  '23514',
  null,
  'the table rejects a blank-looking nickname too'
);

select * from finish();
rollback;
