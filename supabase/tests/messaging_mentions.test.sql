begin;

create extension if not exists pgtap with schema extensions;
select plan(30);

-- seed: 홍길동(…0001)과 김민준(…0100)의 1:1 대화 c…01, 둘과 박새벽·이한별의 그룹 대화 c…02.
create temp table people as
select
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001') as hong,
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000100') as minjun,
  (select pub_id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000100') as minjun_pub,
  (select id from public.profiles where pub_id = 'saebyeok-24') as saebyeok,
  (select id from public.profiles where pub_id = 'hanbyeol-25') as hanbyeol;
grant select on people to authenticated;

insert into private.web_push_subscriptions (id, profile_id, endpoint, p256dh, auth)
values
  (
    'f0000000-0000-0000-0000-000000000011', (select minjun from people),
    'https://push.example.test/minjun', repeat('p', 40), repeat('a', 16)
  ),
  (
    'f0000000-0000-0000-0000-000000000012', (select saebyeok from people),
    'https://push.example.test/saebyeok', repeat('p', 40), repeat('a', 16)
  ),
  (
    'f0000000-0000-0000-0000-000000000013', (select hanbyeol from people),
    'https://push.example.test/hanbyeol', repeat('p', 40), repeat('a', 16)
  );

-- 해당 메시지의 Push를 예약받은 프로필.
create function pg_temp.push_recipients(p_message_id uuid)
returns bigint[]
language sql
as $$
  select coalesce(array_agg(recipient_profile_id order by recipient_profile_id), '{}')
  from private.notification_delivery_outbox
  where message_id = p_message_id;
$$;

select ok(
  not has_function_privilege('authenticated', 'private.resolve_message_mentions(uuid, text, text[], bigint[])', 'EXECUTE')
    and not has_function_privilege('authenticated', 'private.member_wants_message_push(public.conversation_members, private.messages)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'private.message_plain_text(text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.set_conversation_notification_level(uuid, public.conversation_notification_level)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.set_conversation_notification_level(uuid, public.conversation_notification_level)', 'EXECUTE'),
  'mention helpers stay private and only signed-in members set notification levels'
);

-- 전송

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select public.send_message(
  'c0000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000501',
  '[@박새벽](m:1) [@김민준](m:2) 회의 자료 봐 주세요',
  p_mention_pub_ids => array['saebyeok-24', (select minjun_pub from people)]
);

select is(
  (
    select mention_profile_ids
    from public.list_messages('c0000000-0000-0000-0000-000000000002')
    where id = 'e0000000-0000-0000-0000-000000000501'
  ),
  array[(select saebyeok from people), (select minjun from people)],
  'the n-th mentioned profile answers the m:n token'
);

select is(
  (
    select body
    from public.list_messages('c0000000-0000-0000-0000-000000000002')
    where id = 'e0000000-0000-0000-0000-000000000501'
  ),
  '[@박새벽](m:1) [@김민준](m:2) 회의 자료 봐 주세요',
  'the room reads the body with its tokens'
);

select is(
  (select last_message_body from public.list_conversations('c0000000-0000-0000-0000-000000000002')),
  '@박새벽 @김민준 회의 자료 봐 주세요',
  'the conversation preview shows mentions as plain names'
);

select throws_ok(
  $$select public.send_message(
    'c0000000-0000-0000-0000-000000000001',
    'e0000000-0000-0000-0000-000000000502',
    '[@김민준](m:1) 안녕',
    p_mention_pub_ids => array[(select minjun_pub from people)]
  )$$,
  '22023',
  'mentions are only available in group conversations',
  'a direct conversation has no mentions'
);

select throws_ok(
  $$select public.send_message(
    'c0000000-0000-0000-0000-000000000002',
    'e0000000-0000-0000-0000-000000000503',
    '[@관리자](m:1) 봐 주세요',
    p_mention_pub_ids => array['kim-admin']
  )$$,
  '22023',
  'every mention must name a current conversation member',
  'only members of the conversation can be mentioned'
);

select throws_ok(
  $$select public.send_message(
    'c0000000-0000-0000-0000-000000000002',
    'e0000000-0000-0000-0000-000000000504',
    '[@박새벽](m:2) 봐 주세요',
    p_mention_pub_ids => array[null, 'saebyeok-24']
  )$$,
  '22023',
  'mention ordinals must be consecutive',
  'person ordinals start at one without gaps'
);

select throws_ok(
  $$select public.send_message(
    'c0000000-0000-0000-0000-000000000002',
    'e0000000-0000-0000-0000-000000000505',
    '[@박새벽](m:1) 봐 주세요'
  )$$,
  '22023',
  'every mention must name a current conversation member',
  'a token without a matching public id is refused'
);

select public.send_message(
  'c0000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000506',
  '[@모든 사람](m:0) 내일 회의 9시'
);

reset role;

select results_eq(
  $$select mentions_everyone, mention_profile_ids
    from private.messages where id = 'e0000000-0000-0000-0000-000000000506'$$,
  $$values (true, '{}'::bigint[])$$,
  'm:0 mentions everyone without naming anyone'
);

-- 글자로만 보여 주는 곳

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;
select public.send_message(
  'c0000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000507',
  '네 확인할게요',
  'e0000000-0000-0000-0000-000000000501'
);

select is(
  (
    select reply_body
    from public.list_messages('c0000000-0000-0000-0000-000000000002')
    where id = 'e0000000-0000-0000-0000-000000000507'
  ),
  '@박새벽 @김민준 회의 자료 봐 주세요',
  'a reply quotes mentions as plain names'
);

select is(
  jsonb_array_length(
    public.search_messages('c0000000-0000-0000-0000-000000000002', '@박새벽') -> 'results'
  ),
  1,
  'search finds a mention by its shown name'
);

select is(
  jsonb_array_length(
    public.search_messages('c0000000-0000-0000-0000-000000000002', 'm:1') -> 'results'
  ),
  0,
  'search does not match the hidden token'
);
reset role;

select is(
  (
    select body
    from private.message_push_content(
      'e0000000-0000-0000-0000-000000000501', (select minjun from people), private.message_keys()
    )
  ),
  '홍길동: @박새벽 @김민준 회의 자료 봐 주세요',
  'the push body shows mentions as plain names'
);

-- 알림 단계

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;

select public.set_conversation_notification_level('c0000000-0000-0000-0000-000000000002', 'mentions');

select results_eq(
  $$select notification_level::text, muted
    from public.list_conversations('c0000000-0000-0000-0000-000000000002')$$,
  $$values ('mentions'::text, false)$$,
  'a group can notify only on mentions'
);

select throws_ok(
  $$select public.set_conversation_notification_level('c0000000-0000-0000-0000-000000000001', 'mentions')$$,
  '22023',
  'mentions level requires a group conversation',
  'a direct conversation has no mentions-only level'
);

select throws_ok(
  $$select public.set_conversation_notification_level('c0000000-0000-0000-0000-000000000002', null)$$,
  '22023',
  null,
  'the level is required'
);
reset role;

update public.conversation_members
set mentions_only = true
where conversation_id = 'c0000000-0000-0000-0000-000000000002'
  and profile_id = (select hanbyeol from people);
update public.conversation_members
set muted_until = 'infinity'
where conversation_id = 'c0000000-0000-0000-0000-000000000002'
  and profile_id = (select saebyeok from people);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select public.send_message(
  'c0000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000511',
  '그냥 하는 말'
);
select public.send_message(
  'c0000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000512',
  '[@김민준](m:1) [@박새벽](m:2) 확인 부탁',
  p_mention_pub_ids => array[(select minjun_pub from people), 'saebyeok-24']
);
select public.send_message(
  'c0000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000513',
  '[@모든 사람](m:0) 공지'
);
reset role;

select is(
  pg_temp.push_recipients('e0000000-0000-0000-0000-000000000511'),
  '{}'::bigint[],
  'a plain message skips mentions-only and muted members'
);

select is(
  pg_temp.push_recipients('e0000000-0000-0000-0000-000000000512'),
  array[(select minjun from people)],
  'a mention reaches a mentions-only member, but not a muted one'
);

select is(
  pg_temp.push_recipients('e0000000-0000-0000-0000-000000000513'),
  array(select unnest(array[(select minjun from people), (select hanbyeol from people)]) order by 1),
  'mentioning everyone reaches every mentions-only member'
);

select ok(
  private.message_delivery_allowed(
    (select delivery from private.notification_delivery_outbox as delivery
      where message_id = 'e0000000-0000-0000-0000-000000000513'
        and recipient_profile_id = (select minjun from people))
  ),
  'a pending mention push still goes out for a mentions-only member'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;
select public.set_conversation_notification_level('c0000000-0000-0000-0000-000000000002', 'off');
reset role;

select ok(
  not private.message_delivery_allowed(
    (select delivery from private.notification_delivery_outbox as delivery
      where message_id = 'e0000000-0000-0000-0000-000000000513'
        and recipient_profile_id = (select minjun from people))
  ),
  'turning notifications off stops pending mention pushes too'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;
select public.set_conversation_notification_level('c0000000-0000-0000-0000-000000000002', 'all');
select results_eq(
  $$select notification_level::text, muted
    from public.list_conversations('c0000000-0000-0000-0000-000000000002')$$,
  $$values ('all'::text, false)$$,
  'every message notifies again'
);
reset role;

-- 편집

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select public.edit_message(
  'e0000000-0000-0000-0000-000000000511',
  '[@이한별](m:1) 그냥 하는 말',
  array['hanbyeol-25']
);
reset role;

select is(
  pg_temp.push_recipients('e0000000-0000-0000-0000-000000000511'),
  array[(select hanbyeol from people)],
  'an edit pushes to a newly mentioned member'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select public.edit_message(
  'e0000000-0000-0000-0000-000000000511',
  '[@이한별](m:1) [@김민준](m:2) 그냥 하는 말',
  array['hanbyeol-25', (select minjun_pub from people)]
);
reset role;

select is(
  (select count(*) from private.notification_delivery_outbox
    where message_id = 'e0000000-0000-0000-0000-000000000511'
      and recipient_profile_id = (select hanbyeol from people)),
  1::bigint,
  'an edit does not push again to someone already mentioned'
);

select is(
  pg_temp.push_recipients('e0000000-0000-0000-0000-000000000511'),
  array(select unnest(array[(select minjun from people), (select hanbyeol from people)]) order by 1),
  'an edit adds only the newly mentioned member'
);

-- 이미 불린 사람은 나가도 남는다. 새로 부르는 사람만 지금 멤버여야 한다.
update public.conversation_members
set left_at = clock_timestamp()
where conversation_id = 'c0000000-0000-0000-0000-000000000002'
  and profile_id in ((select hanbyeol from people), (select saebyeok from people))
  and left_at is null;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select public.edit_message(
    'e0000000-0000-0000-0000-000000000511',
    '[@이한별](m:1) [@김민준](m:2) 그냥 하는 말!',
    array['hanbyeol-25', (select minjun_pub from people)]
  )$$,
  'a member mentioned before they left can stay in an edit'
);

select throws_ok(
  $$select public.edit_message(
    'e0000000-0000-0000-0000-000000000511',
    '[@박새벽](m:1) 그냥 하는 말',
    array['saebyeok-24']
  )$$,
  '22023',
  'every mention must name a current conversation member',
  'an edit cannot newly mention someone who left'
);

select public.edit_message('e0000000-0000-0000-0000-000000000511', '멘션 없이');
reset role;

select results_eq(
  $$select mention_profile_ids, mentions_everyone
    from private.messages where id = 'e0000000-0000-0000-0000-000000000511'$$,
  $$values ('{}'::bigint[], false)$$,
  'removing every token removes every mention'
);

-- 삭제

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select public.delete_messages(array['e0000000-0000-0000-0000-000000000513']::uuid[]);
reset role;

select results_eq(
  $$select mention_profile_ids, mentions_everyone
    from private.messages where id = 'e0000000-0000-0000-0000-000000000513'$$,
  $$values ('{}'::bigint[], false)$$,
  'deleting a message clears its mentions'
);

select ok(
  private.message_plain_text('[@홍](m:1)와 [@모든 사람](m:0), [링크](https://example.com)')
    = '@홍와 @모든 사람, [링크](https://example.com)',
  'only mention tokens become plain names'
);

select * from finish();

rollback;
