begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0000-000000000002',
  'authenticated', 'authenticated', 'delivery-preferences@kmla.hs.kr', '', now(),
  '{}', '{}', now(), now()
);
update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000000002'
where pub_id = 'hanbyeol-25';

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select public.register_my_web_push_subscription(
  'https://push.example.test/preferences',
  'BNcRdreALRFXTkA0bP8M5bq6fP6w6uLqFhKxqv2QdA',
  'dGVzdC1hdXRoLWtleQ', null
);
reset role;

select private.emit_notification(
  'delivery-pref:content',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'post_commented', 'normal', 'content', 'identified',
  (select id from public.profiles where pub_id = 'saebyeok-24'),
  '박새벽', null, '콘텐츠 알림',
  '20000000-0000-0000-0000-000000000003',
  '90000000-0000-0000-0000-000000000001'
);
select is(
  (select count(*) from private.notification_delivery_outbox where status = 'pending'),
  1::bigint,
  'content delivery is pending before a later opt-out'
);

set local role authenticated;
select public.update_my_notification_preferences(false, true, true, true, true);
reset role;
set local role service_role;
select is(
  (select count(*) from public.claim_notification_deliveries(10, 60)),
  0::bigint,
  'claim re-evaluates a type opt-out made after enqueue'
);
reset role;
select is(
  (select status from private.notification_delivery_outbox where notification_id = (
    select id from public.notifications where title = '콘텐츠 알림'
  )),
  'suppressed'::private.notification_delivery_status,
  'a post-enqueue type opt-out suppresses the unsent delivery'
);

set local role authenticated;
select public.update_my_notification_preferences(true, true, false, true, true);
select public.set_my_group_notification_preferences(
  '20000000-0000-0000-0000-000000000003', 'none', false, false
);
reset role;
select private.emit_notification(
  'delivery-pref:moderation',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'post_moderated', 'high', 'moderation', 'staff',
  (select id from public.profiles where pub_id = 'kim-admin'),
  '운영진', null, '운영 조치', '20000000-0000-0000-0000-000000000003'
);
set local role service_role;
create temp table moderation_claim as
select * from public.claim_notification_deliveries(10, 60);
select is(
  (select count(*) from moderation_claim where title = '운영 조치'),
  1::bigint,
  'moderation ignores type and group opt-outs at claim time'
);
select ok(
  public.complete_notification_delivery(
    (select delivery_id from moderation_claim where title = '운영 조치'),
    (select lease_id from moderation_claim where title = '운영 조치'),
    'sent', 201, null
  ),
  'the moderation claim can be completed'
);
reset role;

set local role authenticated;
select public.update_my_notification_preferences(true, true, true, true, true);
select public.set_my_group_notification_preferences(
  '20000000-0000-0000-0000-000000000003', 'all', true, true
);
reset role;
select private.emit_notification(
  'delivery-pref:group-content',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'post_commented', 'normal', 'content', 'identified',
  (select id from public.profiles where pub_id = 'saebyeok-24'),
  '박새벽', null, '그룹 콘텐츠 알림',
  '20000000-0000-0000-0000-000000000003',
  '90000000-0000-0000-0000-000000000001'
);
set local role authenticated;
select public.set_my_group_notification_preferences(
  '20000000-0000-0000-0000-000000000003', 'all', false, true
);
reset role;
set local role service_role;
select is(
  (select count(*) from public.claim_notification_deliveries(10, 60)),
  0::bigint,
  'claim re-evaluates the group content Push setting after enqueue'
);
reset role;
select is(
  (select status from private.notification_delivery_outbox where notification_id = (
    select id from public.notifications where title = '그룹 콘텐츠 알림'
  )),
  'suppressed'::private.notification_delivery_status,
  'a group Push opt-out suppresses delivery without changing the inbox level'
);

set local role authenticated;
select public.set_my_group_notification_preferences(
  '20000000-0000-0000-0000-000000000003', 'all', true, true
);
reset role;
select private.emit_notification(
  'delivery-pref:group-post',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'group_posted', 'low', 'group', 'identified',
  (select id from public.profiles where pub_id = 'saebyeok-24'),
  '박새벽', null, '새 그룹 글',
  '20000000-0000-0000-0000-000000000003',
  '90000000-0000-0000-0000-000000000001'
);
set local role authenticated;
select public.set_my_group_notification_preferences(
  '20000000-0000-0000-0000-000000000003', 'all', true, false
);
reset role;
set local role service_role;
select is(
  (select count(*) from public.claim_notification_deliveries(10, 60)),
  0::bigint,
  'new-post Push opt-out is re-evaluated after enqueue'
);
reset role;
select is(
  (select status from private.notification_delivery_outbox where notification_id = (
    select id from public.notifications where title = '새 그룹 글'
  )),
  'suppressed'::private.notification_delivery_status,
  'new group posts remain explicit Push opt-in'
);

set local role authenticated;
select public.update_my_notification_preferences(true, true, true, true, true);
select public.set_my_group_notification_preferences(
  '20000000-0000-0000-0000-000000000003', 'all', true, false
);
reset role;
select private.emit_notification(
  'delivery-pref:leased-content',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'post_commented', 'normal', 'content', 'identified',
  (select id from public.profiles where pub_id = 'saebyeok-24'),
  '박새벽', null, 'lease 중 설정 변경',
  '20000000-0000-0000-0000-000000000003',
  '90000000-0000-0000-0000-000000000001'
);
set local role service_role;
create temp table active_preference_claim as
select * from public.claim_notification_deliveries(10, 60);
select is(
  (select count(*) from active_preference_claim where title = 'lease 중 설정 변경'),
  1::bigint,
  'an allowed delivery can be leased before the preference changes'
);
reset role;
set local role authenticated;
select public.update_my_notification_preferences(false, true, true, true, true);
reset role;
set local role service_role;
select is(
  (select count(*) from public.claim_notification_deliveries(10, 60)),
  0::bigint,
  'another claim does not take or suppress an active lease'
);
reset role;
select is(
  (select status from private.notification_delivery_outbox where id = (
    select delivery_id from active_preference_claim where title = 'lease 중 설정 변경'
  )),
  'leased'::private.notification_delivery_status,
  'the original worker keeps its lease until the final authorization check'
);
set local role service_role;
select is(
  public.prepare_notification_delivery(
    (select delivery_id from active_preference_claim where title = 'lease 중 설정 변경'),
    (select lease_id from active_preference_claim where title = 'lease 중 설정 변경')
  ),
  false,
  'the final authorization check suppresses a newly opted-out delivery'
);
reset role;

set local role authenticated;
select public.set_my_group_notification_preferences(
  '20000000-0000-0000-0000-000000000003', 'all', true, true
);
reset role;
select private.emit_notification(
  'delivery-pref:device-removal',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'app_admin_granted', 'high', 'account', 'staff',
  (select id from public.profiles where pub_id = 'kim-admin'),
  '운영진', null, '기기 해제 알림'
);
set local role authenticated;
select ok(
  public.unregister_my_web_push_subscription('https://push.example.test/preferences'),
  'global off removes the current device subscription'
);
reset role;
set local role service_role;
select is(
  (select count(*) from public.claim_notification_deliveries(10, 60)),
  0::bigint,
  'removed devices cannot claim previously unsent delivery work'
);
reset role;

select * from finish();
rollback;
