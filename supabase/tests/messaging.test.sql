begin;

create extension if not exists pgtap with schema extensions;
select plan(30);

-- seed: 홍길동(…0001)과 김민준(…0100)의 1:1 대화 c…01, 홍길동·김민준·박새벽·이한별의 그룹 대화
-- c…02. 이한별은 2026-08-21에 참여해 그 이전 메시지(d…11, d…12)를 볼 수 없다.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000201',
    'authenticated', 'authenticated', 'message-late@kmla.hs.kr', '', now(),
    '', '', '', '', '', '', '', '', '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000202',
    'authenticated', 'authenticated', 'message-outsider@kmla.hs.kr', '', now(),
    '', '', '', '', '', '', '', '', '{}', '{}', now(), now()
  );

update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000000201'
where pub_id = 'hanbyeol-25';

update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000000202'
where pub_id = 'kim-admin';

-- 직접 접근 경계

select ok(
  not has_table_privilege('authenticated', 'public.conversations', 'SELECT')
    and not has_table_privilege('authenticated', 'public.conversation_members', 'SELECT')
    and not has_table_privilege('authenticated', 'private.messages', 'SELECT')
    and not has_table_privilege('authenticated', 'private.messages', 'INSERT'),
  'message tables have no client grants'
);

select ok(
  not has_function_privilege('anon', 'public.list_conversations(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.send_message(uuid, uuid, text, uuid, boolean, text[])', 'EXECUTE')
    and not has_function_privilege('authenticated', 'private.message_keys()', 'EXECUTE')
    and not has_function_privilege(
      'authenticated', 'private.decrypt_message_text(bytea, smallint, jsonb)', 'EXECUTE'
    ),
  'anon cannot call message RPCs and nobody can call the key helpers directly'
);

select ok(
  not exists (
    select 1
    from private.messages
    where position(
      convert_to('도서관', 'UTF8') in body_ciphertext
    ) > 0
  ),
  'ciphertext does not contain the plaintext'
);

select throws_ok(
  $$insert into public.conversations (type, direct_profile_low, direct_profile_high)
    select 'direct', direct_profile_low, direct_profile_high
    from public.conversations
    where id = 'c0000000-0000-0000-0000-000000000001'$$,
  '23505',
  null,
  'only one direct conversation exists per pair'
);

-- 참여 기간

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000201', true);
set local role authenticated;

select results_eq(
  $$select id from public.list_messages('c0000000-0000-0000-0000-000000000002')$$,
  $$values
    ('d0000000-0000-0000-0000-000000000013'::uuid),
    ('d0000000-0000-0000-0000-000000000014'::uuid)$$,
  'a new member sees only messages sent after joining'
);

select is(
  (select unread_count from public.list_conversations('c0000000-0000-0000-0000-000000000002')),
  1,
  'unread count ignores messages before joining and my own messages'
);

select throws_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000002',
      'e0000000-0000-0000-0000-000000000001',
      '답장',
      'd0000000-0000-0000-0000-000000000011'
    )$$,
  '22023',
  null,
  'a member cannot reply to a message from before joining'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000202', true);
set local role authenticated;

select is(
  (select count(*) from public.list_conversations()),
  0::bigint,
  'a non-member lists no conversations'
);

select is(
  (select count(*) from public.list_messages('c0000000-0000-0000-0000-000000000001')),
  0::bigint,
  'a non-member reads no messages'
);

select throws_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000001',
      'e0000000-0000-0000-0000-000000000002',
      '끼어들기'
    )$$,
  '42501',
  null,
  'a non-member cannot send'
);

-- 전송

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

create temp table sent (attempt integer primary key, sent_at timestamptz);
grant all on sent to authenticated;

insert into sent
select 1, sent_at
from public.send_message(
  'c0000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000010',
  E'도착했어\n\n',
  'd0000000-0000-0000-0000-000000000003'
);

insert into sent
select 2, sent_at
from public.send_message(
  'c0000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000010',
  '다른 본문'
);

select is(
  (select sent_at from sent where attempt = 2),
  (select sent_at from sent where attempt = 1),
  'resending the same id returns the first saved message'
);

select results_eq(
  $$select body, reply_to_id, reply_body, unread_member_count
    from public.list_messages('c0000000-0000-0000-0000-000000000001')
    where id = 'e0000000-0000-0000-0000-000000000010'$$,
  $$values (
    '도착했어'::text,
    'd0000000-0000-0000-0000-000000000003'::uuid,
    '나 5분 늦을 것 같아 🙏'::text,
    1
  )$$,
  'the message keeps its first body without trailing newlines, its quote and its unread count'
);

select is(
  (select unread_count from public.list_conversations('c0000000-0000-0000-0000-000000000001')),
  0,
  'sending moves my read position past everything before it'
);

select throws_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000001',
      'e0000000-0000-0000-0000-000000000011',
      E' \n\t'
    )$$,
  '22023',
  null,
  'a blank body is rejected'
);

select throws_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000001',
      'e0000000-0000-0000-0000-000000000011',
      repeat('가', 40001)
    )$$,
  '22023',
  null,
  'a body over the limit is rejected'
);

select throws_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000002',
      'e0000000-0000-0000-0000-000000000011',
      '다른 대화의 답장',
      'd0000000-0000-0000-0000-000000000001'
    )$$,
  '22023',
  null,
  'a reply target must be in the same conversation'
);

-- 페이지

select results_eq(
  $$select id from public.list_messages('c0000000-0000-0000-0000-000000000001', null, null, 2)$$,
  $$values
    ('d0000000-0000-0000-0000-000000000003'::uuid),
    ('e0000000-0000-0000-0000-000000000010'::uuid)$$,
  'the first page is the latest messages in conversation order'
);

select results_eq(
  $$select id from public.list_messages(
      'c0000000-0000-0000-0000-000000000001',
      '2026-08-28 06:12:00+00',
      'd0000000-0000-0000-0000-000000000003',
      2
    )$$,
  $$values
    ('d0000000-0000-0000-0000-000000000001'::uuid),
    ('d0000000-0000-0000-0000-000000000002'::uuid)$$,
  'a cursor returns the messages before it'
);

select throws_ok(
  $$select * from public.list_messages(
      'c0000000-0000-0000-0000-000000000001', now(), null, 2
    )$$,
  '22023',
  null,
  'a cursor needs both parts'
);

-- 읽음 위치

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;

select is(
  (select unread_count from public.list_conversations('c0000000-0000-0000-0000-000000000001')),
  2,
  'the recipient has unread messages'
);

select is(
  public.mark_conversation_read(
    'c0000000-0000-0000-0000-000000000001',
    'e0000000-0000-0000-0000-000000000010'
  ),
  true,
  'reading a newer message moves the read position'
);

select is(
  public.mark_conversation_read(
    'c0000000-0000-0000-0000-000000000001',
    'd0000000-0000-0000-0000-000000000001'
  ),
  false,
  'reading an older message reports that nothing moved'
);

select is(
  (select unread_count from public.list_conversations('c0000000-0000-0000-0000-000000000001')),
  0,
  'the read position only moves forward'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is(
  (
    select unread_member_count
    from public.list_messages('c0000000-0000-0000-0000-000000000001')
    where id = 'e0000000-0000-0000-0000-000000000010'
  ),
  0,
  'the sender sees the message as read by everyone'
);

-- 나간 멤버

reset role;
update public.conversation_members as member
set left_at = now()
from public.profiles as profile
where member.conversation_id = 'c0000000-0000-0000-0000-000000000002'
  and member.profile_id = profile.id
  and profile.pub_id = 'hanbyeol-25';

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

-- `now()`는 트랜잭션 시작 시각이라 나간 시각과 같다. 나간 시각 이후의 메시지만 가려진다.
select public.send_message(
  'c0000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000020',
  '이한별님이 나간 뒤의 메시지'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000201', true);
set local role authenticated;

select ok(
  not exists (
    select 1
    from public.list_messages('c0000000-0000-0000-0000-000000000002')
    where id = 'e0000000-0000-0000-0000-000000000020'
  )
    and exists (
      select 1
      from public.list_messages('c0000000-0000-0000-0000-000000000002')
      where id = 'd0000000-0000-0000-0000-000000000013'
    ),
  'a member who left keeps their period and loses later messages'
);

select is(
  (select last_message_id from public.list_conversations('c0000000-0000-0000-0000-000000000002')),
  'd0000000-0000-0000-0000-000000000014'::uuid,
  'a member who left previews the last message of their period'
);

select throws_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000002',
      'e0000000-0000-0000-0000-000000000021',
      '나간 뒤 전송'
    )$$,
  '42501',
  null,
  'a member who left cannot send'
);

-- 키 교체

reset role;
select vault.create_secret('local-message-key-v2', 'message_key_v2', 'test rotation key');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select public.send_message(
  'c0000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000030',
  '새 키로 보낸 메시지'
);

reset role;

select is(
  (select key_version from private.messages where id = 'e0000000-0000-0000-0000-000000000030'),
  2::smallint,
  'new messages use the latest key version'
);

set local role authenticated;

select results_eq(
  $$select body from public.list_messages('c0000000-0000-0000-0000-000000000001')
    where id in ('d0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000030')$$,
  $$values ('내일 자습 끝나고 도서관 갈래?'::text), ('새 키로 보낸 메시지'::text)$$,
  'messages under old and new keys both decrypt'
);

reset role;
delete from vault.secrets where name ~ '^message_key_v';
set local role authenticated;

select throws_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000001',
      'e0000000-0000-0000-0000-000000000031',
      '키 없이 보내기'
    )$$,
  '55000',
  null,
  'sending without a key fails instead of storing the message'
);

select * from finish();

rollback;
