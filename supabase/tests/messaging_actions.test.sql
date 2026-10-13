begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

-- seed: 홍길동(…0001)과 김민준(…0100)의 1:1 대화 c…01. d…01·d…03은 김민준, d…02는 홍길동의 메시지다.
-- 그룹 대화 c…02에서 이한별은 2026-08-21에 참여해 d…11을 볼 수 없다.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000201',
  'authenticated', 'authenticated', 'message-late@kmla.hs.kr', '', now(),
  '', '', '', '', '', '', '', '', '{}', '{}', now(), now()
);

update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000000201'
where pub_id = 'hanbyeol-25';

select ok(
  not has_table_privilege('authenticated', 'private.message_reactions', 'SELECT')
    and not has_table_privilege('authenticated', 'private.message_pins', 'SELECT')
    and not has_function_privilege('anon', 'public.delete_messages(uuid[])', 'EXECUTE')
    and not has_function_privilege(
      'authenticated', 'private.lock_actionable_message(bigint, uuid)', 'EXECUTE'
    ),
  'reaction and pin tables have no client grants'
);

-- 반응

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select results_eq(
  $$select reactions, my_reaction
    from public.set_message_reaction('d0000000-0000-0000-0000-000000000001', 'love')$$,
  $$values ('[{"count": 1, "reaction": "love"}]'::jsonb, 'love'::public.post_reaction)$$,
  'a member reacts and gets the new tally'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;

select public.set_message_reaction('d0000000-0000-0000-0000-000000000001', 'haha');

select results_eq(
  $$select reactions, my_reaction
    from public.list_messages('c0000000-0000-0000-0000-000000000001')
    where id = 'd0000000-0000-0000-0000-000000000001'$$,
  $$values (
    '[{"count": 1, "reaction": "love"}, {"count": 1, "reaction": "haha"}]'::jsonb,
    'haha'::public.post_reaction
  )$$,
  'pages carry every reaction and my own'
);

select results_eq(
  $$select reactions, my_reaction
    from public.set_message_reaction('d0000000-0000-0000-0000-000000000001', 'love')$$,
  $$values ('[{"count": 2, "reaction": "love"}]'::jsonb, 'love'::public.post_reaction)$$,
  'changing a reaction replaces mine'
);

select results_eq(
  $$select reactions, my_reaction
    from public.set_message_reaction('d0000000-0000-0000-0000-000000000001', null)$$,
  $$values ('[{"count": 1, "reaction": "love"}]'::jsonb, null::public.post_reaction)$$,
  'a null reaction removes mine'
);

select results_eq(
  $$select name, reaction from public.list_message_reactors('d0000000-0000-0000-0000-000000000001')$$,
  $$values ('홍길동'::text, 'love'::public.post_reaction)$$,
  'members see who reacted and with what'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000201', true);
set local role authenticated;

select is(
  (select count(*) from public.list_message_reactors('d0000000-0000-0000-0000-000000000001')),
  0::bigint,
  'people outside the conversation see no reactors'
);

select throws_ok(
  $$select public.set_message_reaction('d0000000-0000-0000-0000-000000000011', 'like')$$,
  'P0002',
  null,
  'a member cannot react to a message from before joining'
);

-- 고정

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select public.set_message_pinned('d0000000-0000-0000-0000-000000000003', true);
select public.set_message_pinned('d0000000-0000-0000-0000-000000000001', true);
select public.set_message_pinned('d0000000-0000-0000-0000-000000000001', true);

select results_eq(
  $$select id from public.list_pinned_messages('c0000000-0000-0000-0000-000000000001')$$,
  $$values
    ('d0000000-0000-0000-0000-000000000001'::uuid),
    ('d0000000-0000-0000-0000-000000000003'::uuid)$$,
  'pinned messages come back in conversation order, once each'
);

select ok(
  (
    select pinned
    from public.list_messages('c0000000-0000-0000-0000-000000000001')
    where id = 'd0000000-0000-0000-0000-000000000003'
  ),
  'pages mark pinned messages'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;

select public.set_message_pinned('d0000000-0000-0000-0000-000000000003', false);

select results_eq(
  $$select id from public.list_pinned_messages('c0000000-0000-0000-0000-000000000001')$$,
  $$values ('d0000000-0000-0000-0000-000000000001'::uuid)$$,
  'any member can unpin'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select public.set_message_pinned('d0000000-0000-0000-0000-000000000011', true);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000201', true);
set local role authenticated;

select throws_ok(
  $$select public.set_message_pinned('d0000000-0000-0000-0000-000000000013', null)$$,
  '22023',
  null,
  'a null pinned state is rejected instead of unpinning'
);

select is(
  (select count(*) from public.list_pinned_messages('c0000000-0000-0000-0000-000000000002')),
  0::bigint,
  'pins outside my membership period are hidden'
);

-- 편집

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select public.send_message(
  'c0000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000100',
  '오타 있는 메시지'
);

select lives_ok(
  $$select public.edit_message('e0000000-0000-0000-0000-000000000100', E'고친 메시지\n')$$,
  'the sender edits within 15 minutes'
);

select results_eq(
  $$select body, edited_at is not null
    from public.list_messages('c0000000-0000-0000-0000-000000000001')
    where id = 'e0000000-0000-0000-0000-000000000100'$$,
  $$values ('고친 메시지'::text, true)$$,
  'the edited body replaces the old one and is marked edited'
);

select throws_ok(
  $$select public.edit_message('d0000000-0000-0000-0000-000000000001', '남의 메시지')$$,
  '42501',
  null,
  'nobody edits someone else''s message'
);

select throws_ok(
  $$select public.edit_message('d0000000-0000-0000-0000-000000000002', '오래된 메시지')$$,
  '22023',
  null,
  'a message older than 15 minutes cannot be edited'
);

select throws_ok(
  $$select public.edit_message('e0000000-0000-0000-0000-000000000100', ' ')$$,
  '22023',
  null,
  'an edit follows the body rules'
);

-- 삭제

select public.set_message_reaction('d0000000-0000-0000-0000-000000000002', 'like');
select public.set_message_pinned('d0000000-0000-0000-0000-000000000002', true);

select throws_ok(
  $$select public.delete_messages(array[
      'd0000000-0000-0000-0000-000000000002',
      'd0000000-0000-0000-0000-000000000001'
    ]::uuid[])$$,
  '42501',
  null,
  'a batch with someone else''s message deletes nothing'
);

select public.delete_messages(array[
  'd0000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000100'
]::uuid[]);

select results_eq(
  $$select id, body, deleted, reactions, pinned
    from public.list_messages('c0000000-0000-0000-0000-000000000001')
    where id in (
      'd0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000100'
    )$$,
  $$values
    ('d0000000-0000-0000-0000-000000000002'::uuid, ''::text, true, '[]'::jsonb, false),
    ('e0000000-0000-0000-0000-000000000100'::uuid, ''::text, true, '[]'::jsonb, false)$$,
  'deleted messages lose body, reactions and pin but keep their place'
);

select results_eq(
  $$select reply_to_id, reply_body, reply_deleted
    from public.list_messages('c0000000-0000-0000-0000-000000000001')
    where id = 'd0000000-0000-0000-0000-000000000003'$$,
  $$values ('d0000000-0000-0000-0000-000000000002'::uuid, ''::text, true)$$,
  'a reply keeps quoting the deleted original without its text'
);

select throws_ok(
  $$select public.set_message_reaction('d0000000-0000-0000-0000-000000000002', 'like')$$,
  'P0002',
  null,
  'a deleted message takes no reactions'
);

select lives_ok(
  $$select public.delete_messages(array['d0000000-0000-0000-0000-000000000002']::uuid[])$$,
  'deleting again is a no-op'
);

reset role;

select ok(
  (
    select body_ciphertext is null and key_version is null
    from private.messages
    where id = 'd0000000-0000-0000-0000-000000000002'
  ),
  'the stored ciphertext is gone'
);

select * from finish();

rollback;
