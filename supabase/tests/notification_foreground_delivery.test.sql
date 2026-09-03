begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0000-000000000002',
  'authenticated', 'authenticated', 'notification-foreground@kmla.hs.kr', '', now(),
  '{}', '{}', now(), now()
);
update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000000002'
where pub_id = 'hanbyeol-25';

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select public.register_my_web_push_subscription(
  'https://push.example.test/foreground',
  'BNcRdreALRFXTkA0bP8M5bq6fP6w6uLqFhKxqv2QdA',
  'dGVzdC1hdXRoLWtleQ', null
);
select ok(
  public.refresh_my_web_push_foreground('https://push.example.test/foreground'),
  'the active device refreshes its foreground heartbeat'
);
reset role;

insert into private.web_push_subscriptions (
  profile_id, endpoint, p256dh, auth
) values (
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'https://push.example.test/background',
  'BNcRdreALRFXTkA0bP8M5bq6fP6w6uLqFhKxqv2QdB',
  'dGVzdC1hdXRoLWtleTI'
);

-- Only low importance yields to the heartbeat. It is broadcast traffic whose
-- system notification would repeat what the open app already shows.
select private.emit_notification(
  'foreground:low',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'post_commented', 'low', 'content', 'identified',
  (select id from public.profiles where pub_id = 'saebyeok-24'),
  '박새벽', null, '포그라운드 낮음 알림',
  '20000000-0000-0000-0000-000000000003',
  '90000000-0000-0000-0000-000000000001'
);
set local role service_role;
create temp table low_claim as
select * from public.claim_notification_deliveries(10, 60);
select is(
  (select count(*) from low_claim),
  1::bigint,
  'a low notification is still claimed for the background device'
);
select is(
  (select endpoint from low_claim),
  'https://push.example.test/background',
  'the foreground device alone is omitted from low delivery'
);
reset role;
select is(
  (select status from private.notification_delivery_outbox as delivery
   join private.web_push_subscriptions as subscription on subscription.id = delivery.subscription_id
   where subscription.endpoint = 'https://push.example.test/foreground'),
  'suppressed'::private.notification_delivery_status,
  'the foreground low delivery is permanently suppressed'
);

-- Normal importance names the recipient directly, so an open app is not
-- evidence that they saw it. The unread badge alone does not stand in for it.
select private.emit_notification(
  'foreground:normal',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'post_commented', 'normal', 'content', 'identified',
  (select id from public.profiles where pub_id = 'saebyeok-24'),
  '박새벽', null, '포그라운드 일반 알림',
  '20000000-0000-0000-0000-000000000003',
  '90000000-0000-0000-0000-000000000001'
);
set local role service_role;
create temp table normal_claim as
select * from public.claim_notification_deliveries(10, 60);
select is(
  (select count(*) from normal_claim where title = '포그라운드 일반 알림'),
  2::bigint,
  'normal importance reaches foreground and background devices'
);
select is(
  (select count(*) from normal_claim
   where title = '포그라운드 일반 알림'
     and importance = 'normal' and category = 'content'
     and tag = 'notification-category:content'),
  2::bigint,
  'normal delivery metadata uses the shared category tag'
);
reset role;

select private.emit_notification(
  'foreground:high',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'app_admin_granted', 'high', 'account', 'staff',
  (select id from public.profiles where pub_id = 'kim-admin'),
  '운영진', null, '포그라운드 중요 알림'
);
set local role service_role;
create temp table high_claim as
select * from public.claim_notification_deliveries(10, 60);
select is(
  (select count(*) from high_claim where title = '포그라운드 중요 알림'),
  2::bigint,
  'high importance reaches foreground and background devices'
);
select is(
  (select count(*) from high_claim
   where importance = 'high' and category = 'account'
     and tag = 'notification:' || notification_id::text),
  2::bigint,
  'high delivery metadata keeps a unique notification tag'
);
reset role;

update private.web_push_subscriptions
set foreground_until = now() - interval '1 second'
where endpoint = 'https://push.example.test/foreground';
select private.emit_notification(
  'foreground:expired',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'post_commented', 'low', 'content', 'identified',
  (select id from public.profiles where pub_id = 'saebyeok-24'),
  '박새벽', null, '만료 후 낮음 알림',
  '20000000-0000-0000-0000-000000000003',
  '90000000-0000-0000-0000-000000000001'
);
set local role service_role;
create temp table expired_claim as
select * from public.claim_notification_deliveries(10, 60);
select is(
  (select count(*) from expired_claim where title = '만료 후 낮음 알림'),
  2::bigint,
  'low delivery resumes on every device after heartbeat expiry'
);
reset role;

set local role authenticated;
select is(
  public.refresh_my_web_push_foreground('https://push.example.test/not-owned'),
  false,
  'the heartbeat RPC cannot update an endpoint the caller does not own'
);
reset role;

select * from finish();
rollback;
