begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

-- seed: 홍길동(…0001)과 김민준(…0100)의 1:1 대화 c…01, 둘과 박새벽·이한별의 그룹 대화 c…02.
create temp table profile_ids as
select
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001') as hong,
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000100') as minjun;
grant select on profile_ids to authenticated;

insert into private.web_push_subscriptions (id, profile_id, endpoint, p256dh, auth)
values
  (
    'f0000000-0000-0000-0000-000000000001', (select hong from profile_ids),
    'https://push.example.test/hong', repeat('p', 40), repeat('a', 16)
  ),
  (
    'f0000000-0000-0000-0000-000000000002', (select minjun from profile_ids),
    'https://push.example.test/minjun', repeat('p', 40), repeat('a', 16)
  );

create temp table earlier_requests as select id from net.http_request_queue;

select ok(
  not has_function_privilege('authenticated', 'public.next_message_delivery_at(integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.claim_notification_deliveries(integer, integer)', 'EXECUTE')
    and not has_table_privilege('authenticated', 'private.notification_dispatcher_wakes', 'SELECT'),
  'dispatcher entry points stay server-only'
);

-- 예약

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select public.send_message(
  'c0000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000401',
  '도서관 앞이야'
);

reset role;

select results_eq(
  $$select recipient_profile_id, subscription_id, channel::text, status::text,
      available_at = (select sent_at from private.messages
        where id = 'e0000000-0000-0000-0000-000000000401') + interval '2 seconds'
    from private.notification_delivery_outbox
    where message_id = 'e0000000-0000-0000-0000-000000000401'$$,
  $$values (
    (select minjun from profile_ids),
    'f0000000-0000-0000-0000-000000000002'::uuid,
    'web_push', 'pending', true
  )$$,
  'a message queues one push per recipient subscription, two seconds later, never to the sender'
);

select ok(
  not exists (
    select 1
    from private.notification_delivery_outbox
    where message_id = 'e0000000-0000-0000-0000-000000000401'
      and notification_id is not null
  ),
  'message pushes create no notification rows'
);

select is(
  (select count(*) from net.http_request_queue where id not in (select id from earlier_requests)),
  1::bigint,
  'sending wakes the dispatcher immediately'
);

set local role authenticated;
select public.send_message(
  'c0000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000402',
  '어디야?'
);
reset role;

select is(
  (select count(*) from net.http_request_queue where id not in (select id from earlier_requests)),
  1::bigint,
  'a second message within a second does not wake it again'
);

select ok(
  (select public.next_message_delivery_at(5)) is not null,
  'the dispatcher sees the message pushes that are about to become due'
);

-- 발송 직전 확인과 내용

-- 2초 대기를 건너뛰어 지금 보낼 수 있게 한다.
update private.notification_delivery_outbox
set available_at = now() - interval '1 second'
where message_id is not null;

set local role service_role;
create temp table claimed as
select * from public.claim_notification_deliveries(50, 60);
reset role;

select results_eq(
  $$select message_id, conversation_id, title, body, tag, notification_id
    from claimed$$,
  $$values (
    'e0000000-0000-0000-0000-000000000402'::uuid,
    'c0000000-0000-0000-0000-000000000001'::uuid,
    '홍길동'::text,
    '어디야?'::text,
    'message:c0000000-0000-0000-0000-000000000001'::text,
    null::uuid
  )$$,
  'only the newest pending push of a conversation is sent, titled by the sender with the body'
);

select is(
  (
    select status::text
    from private.notification_delivery_outbox
    where message_id = 'e0000000-0000-0000-0000-000000000401'
  ),
  'suppressed',
  'the older push of the same conversation is suppressed'
);

-- 읽었으면 보내지 않는다.

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;
select public.mark_conversation_read(
  'c0000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000402'
);
reset role;

set local role service_role;
select is(
  public.prepare_notification_delivery(
    (select delivery_id from claimed), (select lease_id from claimed)
  ),
  false,
  'a push for a message the recipient already read is suppressed before sending'
);
reset role;

-- 내용 가리기

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;
select public.set_my_message_preview_hidden(true);

select is(
  (select message_preview_hidden from public.get_my_notification_preferences()),
  true,
  'the preview setting is saved'
);

select throws_ok(
  $$select public.set_my_message_preview_hidden(null)$$,
  '22023',
  null,
  'the preview setting rejects null'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select public.send_message(
  'c0000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000403',
  '비밀 이야기'
);
reset role;

select results_eq(
  $$select title, body
    from private.message_push_content(
      'e0000000-0000-0000-0000-000000000403', (select minjun from profile_ids), private.message_keys()
    )$$,
  $$values ('홍길동'::text, '새 메시지가 있습니다.'::text)$$,
  'a hidden preview names the sender without the body'
);

-- 그룹 대화

select results_eq(
  $$select title, body
    from private.message_push_content(
      'd0000000-0000-0000-0000-000000000014', (select hong from profile_ids), private.message_keys()
    )$$,
  $$values ('학생회 기획부'::text, '김민준: 환영해요 👋'::text)$$,
  'a group push is titled by the conversation and prefixed by the sender'
);

select is(
  (
    select char_length(body)
    from private.message_push_content(
      'd0000000-0000-0000-0000-000000000014', (select hong from profile_ids),
      jsonb_build_object('1', (select decrypted_secret from vault.decrypted_secrets where name = 'message_key_v1'))
    )
  ),
  char_length('김민준: 환영해요 👋'),
  'push content decrypts with the stored key version'
);

-- 대화 알림 끄기

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;
select public.set_conversation_muted('c0000000-0000-0000-0000-000000000001', true);

select is(
  (select muted from public.list_conversations('c0000000-0000-0000-0000-000000000001')),
  true,
  'a muted conversation shows as muted'
);
reset role;

select ok(
  not private.message_delivery_allowed(
    (select delivery from private.notification_delivery_outbox as delivery
      where message_id = 'e0000000-0000-0000-0000-000000000403')
  ),
  'pending pushes stop once the conversation is muted'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select public.send_message(
  'c0000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000404',
  '조용한 메시지'
);
reset role;

select is(
  (select count(*) from private.notification_delivery_outbox
    where message_id = 'e0000000-0000-0000-0000-000000000404'),
  0::bigint,
  'a muted member gets no new pushes'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;
select public.set_conversation_muted('c0000000-0000-0000-0000-000000000001', false);

select is(
  (select muted from public.list_conversations('c0000000-0000-0000-0000-000000000001')),
  false,
  'unmuting turns pushes back on'
);

select throws_ok(
  $$select public.set_conversation_muted('c0000000-0000-0000-0000-000000000002', null)$$,
  '22023',
  null,
  'mute needs an explicit state'
);
reset role;

-- 삭제된 메시지

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select public.delete_messages(array['e0000000-0000-0000-0000-000000000403']::uuid[]);
reset role;

select ok(
  not private.message_delivery_allowed(
    (select delivery from private.notification_delivery_outbox as delivery
      where message_id = 'e0000000-0000-0000-0000-000000000403')
  ),
  'a deleted message is not pushed'
);

-- 정리

update private.notification_delivery_outbox
set status = 'sent', completed_at = now() - interval '31 days'
where message_id = 'e0000000-0000-0000-0000-000000000402';

select private.cleanup_expired_notifications();

select ok(
  not exists (
    select 1 from private.notification_delivery_outbox
    where message_id = 'e0000000-0000-0000-0000-000000000402'
  )
    and exists (
      select 1 from private.notification_delivery_outbox
      where message_id = 'e0000000-0000-0000-0000-000000000403'
    ),
  'finished message pushes older than 30 days are pruned, newer ones stay'
);

-- 연달아 보내는 동안에도 너무 오래 밀리지는 않는다.

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select public.send_message(
  'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000405', '하나'
);
select public.send_message(
  'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000406', '둘'
);
select public.send_message(
  'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000407', '셋'
);
reset role;

update private.notification_delivery_outbox
set status = 'suppressed', completed_at = now()
where message_id = 'e0000000-0000-0000-0000-000000000405';

select ok(
  not private.message_delivery_allowed(
    (select delivery from private.notification_delivery_outbox as delivery
      where message_id = 'e0000000-0000-0000-0000-000000000406')
  ),
  'in a short burst only the newest push goes out'
);

-- 테스트 트랜잭션 안에서는 `now()`가 멈춰 있으므로 기다리는 대신 시각을 당긴다. 읽음 위치도 함께
-- 당겨 건너뛴 메시지가 여전히 안 읽은 메시지로 남게 한다.
update private.messages
set sent_at = sent_at - interval '1 minute'
where id = 'e0000000-0000-0000-0000-000000000405';
update public.conversation_members
set last_read_sent_at = last_read_sent_at - interval '2 minutes'
where conversation_id = 'c0000000-0000-0000-0000-000000000001'
  and profile_id = (select minjun from profile_ids);

select ok(
  private.message_delivery_allowed(
    (select delivery from private.notification_delivery_outbox as delivery
      where message_id = 'e0000000-0000-0000-0000-000000000406')
  ),
  'once a skipped message has waited 10 seconds, a push goes out despite newer ones'
);

-- 최근에 깨웠으면 잠그지도 부르지도 않는다.
create temp table before_wake as select id from net.http_request_queue;
select private.wake_notification_dispatcher();

select is(
  (select count(*) from net.http_request_queue where id not in (select id from before_wake)),
  0::bigint,
  'a wake within a second of the last one is skipped'
);

select * from finish();

rollback;
