begin;

create extension if not exists pgtap with schema extensions;
select plan(29);

select is(
  (
    select count(*)
    from cron.job
    where jobname = 'dispatch-notifications-every-30-seconds'
  ),
  1::bigint,
  'exactly one notification dispatcher cron job is scheduled'
);
select is(
  (
    select schedule
    from cron.job
    where jobname = 'dispatch-notifications-every-30-seconds'
  ),
  '30 seconds',
  'the notification dispatcher runs every 30 seconds'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_notification_deliveries(integer,integer)',
    'EXECUTE'
  ),
  'delivery claims are service-only'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_notification_deliveries(integer,integer)',
    'EXECUTE'
  ),
  'the dispatcher can claim delivery work'
);

select is(
  (
    select notification_level
    from public.group_memberships as membership
    join public.groups as group_record on group_record.id = membership.group_id
    where group_record.kind = 'official'
    limit 1
  ),
  'all'::public.group_notification_level,
  'existing official memberships are backfilled to all notifications'
);
select is(
  (
    select notification_level
    from public.group_memberships as membership
    join public.groups as group_record on group_record.id = membership.group_id
    where group_record.kind = 'unofficial'
    limit 1
  ),
  'direct'::public.group_notification_level,
  'unofficial memberships default to direct notifications'
);

select private.emit_notification(
  'test:reaction:actor-a',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'post_reacted', 'low', 'content', 'identified',
  (select id from public.profiles where pub_id = 'saebyeok-24'),
  '박새벽', null, '새 반응', null,
  '90000000-0000-0000-0000-000000000001', null, null, null,
  'test:reaction:aggregate'
);
select private.emit_notification(
  'test:reaction:actor-b',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'post_reacted', 'low', 'content', 'identified',
  (select id from public.profiles where pub_id = 'pureum-23'),
  '최푸름', null, '새 반응', null,
  '90000000-0000-0000-0000-000000000001', null, null, null,
  'test:reaction:aggregate'
);
select is(
  (select count(*) from public.notifications where title = '새 반응'),
  1::bigint,
  'different actors aggregate into one reaction notification'
);
select is(
  (select actor_count from public.notifications where title = '새 반응'),
  2,
  'reaction aggregation tracks the distinct actor count'
);

update public.notifications set read_at = now() where title = '새 반응';
select private.emit_notification(
  'test:reaction:actor-b',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'post_reacted', 'low', 'content', 'identified',
  (select id from public.profiles where pub_id = 'pureum-23'),
  '최푸름', null, '새 반응', null,
  '90000000-0000-0000-0000-000000000001', null, null, null,
  'test:reaction:aggregate'
);
select is(
  (select actor_count from public.notifications where title = '새 반응'),
  2,
  'the same actor event is idempotent'
);
select ok(
  (select read_at is not null from public.notifications where title = '새 반응'),
  'an idempotent reaction does not make the aggregate unread again'
);

-- Reuse the row as a push-eligible content notification for the lease seam.
update public.notifications
set kind = 'post_commented', importance = 'normal'
where title = '새 반응';

insert into private.web_push_subscriptions (
  id, profile_id, endpoint, p256dh, auth, created_at
) values (
  '71000000-0000-0000-0000-000000000001',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'https://push.example.test/backend',
  'BNcRdreALRFXTkA0bP8M5bq6fP6w6uLqFhKxqv2QdA',
  'dGVzdC1hdXRoLWtleQ',
  now() - interval '1 hour'
);
insert into private.notification_delivery_outbox (
  id, notification_id, recipient_profile_id, subscription_id, channel
) select
  '72000000-0000-0000-0000-000000000001', id, recipient_profile_id,
  '71000000-0000-0000-0000-000000000001', 'web_push'
from public.notifications where title = '새 반응';

set local role service_role;
create temp table claimed_delivery as
select * from public.claim_notification_deliveries(1, 60);
select is((select count(*) from claimed_delivery), 1::bigint, 'one due delivery is leased');
select ok(
  (select lease_id is not null from claimed_delivery),
  'a claim returns an opaque lease token'
);
reset role;
update private.notification_delivery_outbox
set lease_expires_at = now() - interval '1 second'
where id = '72000000-0000-0000-0000-000000000001';
set local role service_role;
select ok(
  public.complete_notification_delivery(
    '72000000-0000-0000-0000-000000000001',
    (select lease_id from claimed_delivery),
    'retry', 503, 'push_unavailable'
  ),
  'the lease owner can record a result after transport outlives the lease'
);
reset role;
select is(
  (select status from private.notification_delivery_outbox where id = '72000000-0000-0000-0000-000000000001'),
  'pending'::private.notification_delivery_status,
  'retry returns the delivery to pending'
);
select ok(
  (select available_at > now() from private.notification_delivery_outbox where id = '72000000-0000-0000-0000-000000000001'),
  'retry applies a future backoff'
);

insert into public.notifications (
  id, recipient_profile_id, kind, importance, category, actor_identity, title,
  created_at, last_activity_at
) values
  (
    '70000000-0000-0000-0000-000000000011',
    (select id from public.profiles where pub_id = 'hanbyeol-25'),
    'account_approved', 'high', 'account', 'staff', '시도 한도 도달',
    now(), now()
  ),
  (
    '70000000-0000-0000-0000-000000000012',
    (select id from public.profiles where pub_id = 'hanbyeol-25'),
    'account_approved', 'high', 'account', 'staff', '정상 대기 알림',
    now(), now()
  );
insert into private.notification_delivery_outbox (
  id, notification_id, recipient_profile_id, subscription_id, channel,
  status, attempt_count, lease_id, lease_expires_at, created_at
) values
  (
    '72000000-0000-0000-0000-000000000011',
    '70000000-0000-0000-0000-000000000011',
    (select id from public.profiles where pub_id = 'hanbyeol-25'),
    '71000000-0000-0000-0000-000000000001', 'web_push',
    'leased', 10, '73000000-0000-0000-0000-000000000011',
    now() - interval '1 minute', now() - interval '2 minutes'
  ),
  (
    '72000000-0000-0000-0000-000000000012',
    '70000000-0000-0000-0000-000000000012',
    (select id from public.profiles where pub_id = 'hanbyeol-25'),
    '71000000-0000-0000-0000-000000000001', 'web_push',
    'pending', 0, null, null, now()
  );

set local role service_role;
select lives_ok(
  $$create temp table exhausted_claim as
    select * from public.claim_notification_deliveries(10, 60)$$,
  'an exhausted lease does not fail the claim batch'
);
reset role;
select is(
  (select count(*) from exhausted_claim where delivery_id = '72000000-0000-0000-0000-000000000012'),
  1::bigint,
  'healthy due work is claimed alongside an exhausted lease'
);
select is(
  (select status from private.notification_delivery_outbox where id = '72000000-0000-0000-0000-000000000011'),
  'dead'::private.notification_delivery_status,
  'an exhausted lease becomes dead-lettered'
);
select ok(
  (
    select lease_id is null
      and lease_expires_at is null
      and completed_at is not null
      and last_error_code = 'attempts_exhausted'
      and attempt_count = 10
    from private.notification_delivery_outbox
    where id = '72000000-0000-0000-0000-000000000011'
  ),
  'dead-lettering clears the lease without exceeding the hard attempt limit'
);

-- 404/410은 구독을 지우지 않고 표시만 한다. 지우면 outbox와 시도 기록이 cascade로 함께
-- 사라져 왜 안 왔는지 볼 근거가 없어진다.
set local role service_role;
select ok(
  public.complete_notification_delivery(
    '72000000-0000-0000-0000-000000000012',
    (select lease_id from exhausted_claim where delivery_id = '72000000-0000-0000-0000-000000000012'),
    'gone', 410, null
  ),
  'the lease owner can record a gone subscription'
);
reset role;
select ok(
  (select gone_at is not null from private.web_push_subscriptions where id = '71000000-0000-0000-0000-000000000001'),
  'a gone result marks the subscription instead of deleting it'
);
select ok(
  (
    select status = 'dead' and last_status_code = 410
    from private.notification_delivery_outbox
    where id = '72000000-0000-0000-0000-000000000012'
  ),
  'the delivery ends dead with the push service status kept'
);
select is(
  (
    select outcome from private.notification_delivery_attempts
    where delivery_id = '72000000-0000-0000-0000-000000000012'
  ),
  'gone',
  'the gone attempt stays on record'
);
insert into public.notifications (
  id, recipient_profile_id, kind, importance, category, actor_identity, title,
  created_at, last_activity_at
) values (
  '70000000-0000-0000-0000-000000000013',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'account_approved', 'high', 'account', 'staff', '죽은 구독 이후 알림',
  now(), now()
);
select is(
  private.enqueue_notification_push('70000000-0000-0000-0000-000000000013'),
  0,
  'new notifications are not queued for a gone subscription'
);

-- delivery가 쌓인 뒤 구독이 새 키로 다시 등록됐다면 그 410은 옛 키에 대한 답이다. 방금 살아난
-- 구독을 다시 죽이면 안 된다.
update private.web_push_subscriptions
set gone_at = null, updated_at = now() + interval '1 second'
where id = '71000000-0000-0000-0000-000000000001';
insert into private.notification_delivery_outbox (
  id, notification_id, recipient_profile_id, subscription_id, channel,
  status, attempt_count, lease_id, lease_expires_at
) values (
  '72000000-0000-0000-0000-000000000013',
  '70000000-0000-0000-0000-000000000013',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  '71000000-0000-0000-0000-000000000001', 'web_push',
  'leased', 1, '73000000-0000-0000-0000-000000000013',
  now() + interval '1 minute'
);
set local role service_role;
select ok(
  public.complete_notification_delivery(
    '72000000-0000-0000-0000-000000000013',
    '73000000-0000-0000-0000-000000000013',
    'gone', 410, null
  ),
  'a gone result for an older key is still recorded'
);
reset role;
select ok(
  (select gone_at is null from private.web_push_subscriptions where id = '71000000-0000-0000-0000-000000000001'),
  'a gone result for an older key does not kill a re-registered subscription'
);

insert into public.notifications (
  recipient_profile_id, kind, importance, category, actor_identity, title,
  created_at, last_activity_at
) values (
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'group_deleted', 'high', 'group', 'system', '만료 알림',
  now() - interval '31 days', now() - interval '31 days'
);
update private.web_push_subscriptions
set gone_at = now() - interval '31 days'
where id = '71000000-0000-0000-0000-000000000001';
select is(private.cleanup_expired_notifications(), 1::bigint, 'retention removes notifications after 30 days');
select is((select count(*) from public.notifications where title = '만료 알림'), 0::bigint, 'expired notification data is gone');
select ok(
  not exists (select 1 from private.web_push_subscriptions where id = '71000000-0000-0000-0000-000000000001'),
  'retention removes subscriptions that have been gone for 30 days'
);

select * from finish();
rollback;
