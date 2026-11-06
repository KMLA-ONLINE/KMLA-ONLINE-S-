begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

-- 보낸 사람이 메시지를 지우면 이미 띄운 카드를 고쳐 쓸 Push를 예약한다(알림 기술 설계 §11.5).
-- seed: 홍길동(…0001)과 김민준(…0100)의 1:1 대화 c…01.
create temp table profile_ids as
select
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001') as hong,
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000100') as minjun;
grant select on profile_ids to authenticated;

insert into private.web_push_subscriptions (id, profile_id, endpoint, p256dh, auth)
values (
  'f0000000-0000-0000-0000-000000000102', (select minjun from profile_ids),
  'https://push.example.test/minjun-deleted', repeat('p', 40), repeat('a', 16)
);

-- seed의 지난 대화는 읽은 것으로 둔다. 남겨 두면 삭제 Push가 대신 보일 메시지로 그것을 고른다.
create temp table seeded_last as
select id
from private.messages
where conversation_id = 'c0000000-0000-0000-0000-000000000001'
order by sent_at desc, id desc
limit 1;
grant select on seeded_last to authenticated;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;
select public.mark_conversation_read(
  'c0000000-0000-0000-0000-000000000001', (select id from seeded_last)
);
reset role;

-- 보내고, 2초 대기를 건너뛰고, 디스패처가 가져가 보낸 것으로 둔다.
create function pg_temp.send_from_hong(p_id uuid, p_body text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  perform public.send_message('c0000000-0000-0000-0000-000000000001', p_id, p_body);
  reset role;
end;
$$;

create function pg_temp.dispatch() returns setof record
language plpgsql as $$
begin
  update private.notification_delivery_outbox
  set available_at = now() - interval '1 second'
  where message_id is not null and status = 'pending';
  set local role service_role;
  return query
    select claimed.message_id, claimed.message_event, claimed.title, claimed.body
    from public.claim_notification_deliveries(50, 60) as claimed
    where claimed.message_id is not null;
  reset role;
  update private.notification_delivery_outbox
  set status = 'sent', completed_at = now(), lease_id = null, lease_expires_at = null
  where status = 'leased' and message_id is not null;
end;
$$;

create function pg_temp.delete_from_hong(p_id uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  perform public.delete_messages(array[p_id]);
  reset role;
end;
$$;

create function pg_temp.deleted_rows(p_id uuid) returns bigint
language sql as $$
  select count(*)
  from private.notification_delivery_outbox
  where message_id = p_id
    and message_event = 'deleted'
    and subscription_id = 'f0000000-0000-0000-0000-000000000102';
$$;

-- 새 메시지 둘 중 최신 것만 카드로 나간다.
select pg_temp.send_from_hong('e0000000-0000-0000-0000-000000000901', '첫 메시지');
select pg_temp.send_from_hong('e0000000-0000-0000-0000-000000000902', '두 번째');
select * from pg_temp.dispatch() as (message_id uuid, message_event text, title text, body text);

select pg_temp.delete_from_hong('e0000000-0000-0000-0000-000000000902');

select is(
  pg_temp.deleted_rows('e0000000-0000-0000-0000-000000000902'),
  1::bigint,
  'deleting the message on a shown card queues a rewrite for that device'
);

select results_eq(
  $$select message_event, title, body
    from pg_temp.dispatch() as (message_id uuid, message_event text, title text, body text)
    where message_id = 'e0000000-0000-0000-0000-000000000902'$$,
  $$values ('deleted'::text, '홍길동'::text, '첫 메시지'::text)$$,
  'the rewrite shows the newest message the recipient has not read'
);

-- 카드로 나간 적 없는 메시지를 지우면 고칠 카드가 없다.
select pg_temp.delete_from_hong('e0000000-0000-0000-0000-000000000901');

select is(
  pg_temp.deleted_rows('e0000000-0000-0000-0000-000000000901'),
  0::bigint,
  'a message that never reached a card queues nothing'
);

-- 대신 보일 안 읽은 메시지가 없으면 삭제 문구로 덮는다.
select pg_temp.send_from_hong('e0000000-0000-0000-0000-000000000903', '세 번째');
select * from pg_temp.dispatch() as (message_id uuid, message_event text, title text, body text);
select pg_temp.delete_from_hong('e0000000-0000-0000-0000-000000000903');

select results_eq(
  $$select message_event, body
    from pg_temp.dispatch() as (message_id uuid, message_event text, title text, body text)
    where message_id = 'e0000000-0000-0000-0000-000000000903'$$,
  $$values ('deleted'::text, '삭제된 메시지입니다.'::text)$$,
  'without another unread message the card says the message was deleted'
);

-- 읽은 뒤에는 앱이 카드를 닫았으므로 보내지 않는다.
select pg_temp.send_from_hong('e0000000-0000-0000-0000-000000000904', '네 번째');
select * from pg_temp.dispatch() as (message_id uuid, message_event text, title text, body text);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;
select public.mark_conversation_read(
  'c0000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000904'
);
reset role;

select pg_temp.delete_from_hong('e0000000-0000-0000-0000-000000000904');

select is(
  pg_temp.deleted_rows('e0000000-0000-0000-0000-000000000904'),
  0::bigint,
  'a message the recipient already read queues nothing'
);

-- 카드가 그 뒤의 새 메시지로 바뀔 참이면 삭제 Push는 건너뛴다.
select pg_temp.send_from_hong('e0000000-0000-0000-0000-000000000905', '다섯 번째');
select * from pg_temp.dispatch() as (message_id uuid, message_event text, title text, body text);
select pg_temp.send_from_hong('e0000000-0000-0000-0000-000000000906', '여섯 번째');
select pg_temp.delete_from_hong('e0000000-0000-0000-0000-000000000905');

select is(
  pg_temp.deleted_rows('e0000000-0000-0000-0000-000000000905'),
  1::bigint,
  'a newer message still waiting does not stop the rewrite from being queued'
);

select results_eq(
  $$select message_id, message_event
    from pg_temp.dispatch() as (message_id uuid, message_event text, title text, body text)$$,
  $$values ('e0000000-0000-0000-0000-000000000906'::uuid, null::text)$$,
  'the newer message replaces the card and the rewrite is not sent'
);

select is(
  (
    select status::text
    from private.notification_delivery_outbox
    where message_id = 'e0000000-0000-0000-0000-000000000905' and message_event = 'deleted'
  ),
  'suppressed',
  'the superseded rewrite is suppressed'
);

-- 디스패처가 가져가 보내는 중에 지우면, 그 Push가 끝난 뒤에 고쳐 쓴다.
select pg_temp.send_from_hong('e0000000-0000-0000-0000-000000000907', '일곱 번째');
update private.notification_delivery_outbox
set available_at = now() - interval '1 second'
where message_id is not null and status = 'pending';
set local role service_role;
select count(*) from public.claim_notification_deliveries(50, 60);
reset role;
select pg_temp.delete_from_hong('e0000000-0000-0000-0000-000000000907');

select ok(
  (
    select deleted.available_at = original.lease_expires_at
    from private.notification_delivery_outbox as deleted
    join private.notification_delivery_outbox as original
      on original.message_id = deleted.message_id
      and original.subscription_id = deleted.subscription_id
      and original.message_event is null
    where deleted.message_id = 'e0000000-0000-0000-0000-000000000907'
      and deleted.message_event = 'deleted'
      and deleted.subscription_id = 'f0000000-0000-0000-0000-000000000102'
  ),
  'a push still being delivered queues the rewrite for after its lease'
);

update private.notification_delivery_outbox
set status = 'sent', completed_at = now(), lease_id = null, lease_expires_at = null
where status = 'leased' and message_id = 'e0000000-0000-0000-0000-000000000907';

select results_eq(
  $$select message_id, message_event, body
    from pg_temp.dispatch() as (message_id uuid, message_event text, title text, body text)$$,
  $$values (
    'e0000000-0000-0000-0000-000000000907'::uuid, 'deleted'::text, '여섯 번째'::text
  )$$,
  'once the in-flight push went out, the rewrite follows it'
);

select ok(
  not has_function_privilege(
    'authenticated', 'private.enqueue_message_deleted_push(uuid[])', 'EXECUTE'
  ),
  'clients cannot queue deletion pushes directly'
);

select * from finish();
rollback;
