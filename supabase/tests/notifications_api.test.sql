begin;

create extension if not exists pgtap with schema extensions;
select plan(34);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.notifications'::regclass),
  'notifications have RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'public.notifications', 'INSERT'),
  'clients cannot create notifications directly'
);
select ok(
  has_table_privilege('authenticated', 'public.notifications', 'SELECT'),
  'authenticated clients can select through recipient RLS'
);
select ok(
  not has_table_privilege('authenticated', 'private.web_push_subscriptions', 'SELECT'),
  'push capability secrets cannot be read by clients'
);
select ok(
  not has_table_privilege('authenticated', 'private.notification_delivery_outbox', 'SELECT'),
  'delivery jobs cannot be read by clients'
);
select ok(
  has_function_privilege('authenticated', 'public.list_my_notifications(timestamptz,uuid,integer)', 'EXECUTE'),
  'notification list RPC is explicitly exposed'
);
select ok(
  not has_function_privilege('anon', 'public.list_my_notifications(timestamptz,uuid,integer)', 'EXECUTE'),
  'anonymous clients cannot list notifications'
);
select ok(
  has_function_privilege('service_role', 'public.prepare_notification_delivery(uuid,uuid)', 'EXECUTE'),
  'the delivery worker can run the final authorization check'
);
select ok(
  not has_function_privilege('authenticated', 'public.prepare_notification_delivery(uuid,uuid)', 'EXECUTE'),
  'clients cannot prepare leased delivery work'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0000-000000000002',
  'authenticated', 'authenticated', 'notifications-api@kmla.hs.kr', '', now(),
  '{}', '{}', now(), now()
);

update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000000002'
where pub_id = 'hanbyeol-25';

insert into public.notifications (
  id, recipient_profile_id, kind, importance, category, actor_identity,
  actor_profile_id, actor_display_name, group_id, post_id, title, created_at, last_activity_at
)
values
  (
    '70000000-0000-0000-0000-000000000001',
    (select id from public.profiles where pub_id = 'hanbyeol-25'),
    'post_commented', 'normal', 'content', 'identified',
    (select id from public.profiles where pub_id = 'saebyeok-24'), '홍길동',
    '20000000-0000-0000-0000-000000000003',
    '90000000-0000-0000-0000-000000000001', '댓글 알림',
    now() - interval '1 hour', now() - interval '1 hour'
  ),
  (
    '70000000-0000-0000-0000-000000000002',
    (select id from public.profiles where pub_id = 'kim-admin'),
    'post_commented', 'normal', 'content', 'identified',
    (select id from public.profiles where pub_id = 'saebyeok-24'), '홍길동',
    '20000000-0000-0000-0000-000000000003',
    '90000000-0000-0000-0000-000000000001', '다른 사용자 알림',
    now(), now()
  );

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select is(
  (select count(*) from public.notifications),
  1::bigint,
  'recipient RLS exposes only the caller notifications'
);
select is(
  (select count(*) from public.list_my_notifications(null, null, 20)),
  1::bigint,
  'list RPC returns the caller page'
);
select throws_ok(
  $$select * from public.list_my_notifications(null, null, 0)$$,
  '22023', 'notification page limit must be between 1 and 50',
  'list RPC validates its page limit'
);
select throws_ok(
  $$select * from public.list_my_notifications(now(), null, 20)$$,
  '22023', 'notification cursor must be complete',
  'list RPC requires a complete cursor'
);
select is(
  public.get_my_recent_unread_notification_count(),
  1::bigint,
  'recent unread count includes unread activity from the last day'
);
select ok(
  public.mark_my_notification_read('70000000-0000-0000-0000-000000000001'),
  'a recipient can mark one notification read'
);
select ok(
  (select read_at is not null from public.notifications where id = '70000000-0000-0000-0000-000000000001'),
  'mark read stores the read timestamp'
);
select is(
  public.get_my_recent_unread_notification_count(),
  0::bigint,
  'read notifications leave the badge count'
);
select is(
  public.mark_all_my_notifications_read(),
  0::bigint,
  'mark all reports the number changed'
);

select ok(
  (select content_push_enabled and timeline_push_enabled and group_push_enabled
     and account_push_enabled and school_push_enabled
   from public.get_my_notification_preferences()),
  'normal and high categories default to push enabled'
);
select lives_ok(
  $$select public.update_my_notification_preferences(false, true, false, true, false)$$,
  'the caller can update account-wide category preferences'
);
select is(
  (select row(content_push_enabled, timeline_push_enabled, group_push_enabled,
              account_push_enabled, school_push_enabled)::text
   from public.get_my_notification_preferences()),
  '(f,t,f,t,f)',
  'updated preferences round trip through the public API'
);

select lives_ok(
  $$select public.set_my_group_notification_preferences(
      '20000000-0000-0000-0000-000000000003', 'all', false, true
    )$$,
  'a member can update group notification preferences'
);
select is(
  (select row(notification_level, content_push_enabled, new_post_push_enabled)::text
   from public.group_memberships
   where group_id = '20000000-0000-0000-0000-000000000003'
     and profile_id = private.current_profile_id()),
  '(all,f,t)',
  'inbox and group Push preferences are stored independently'
);
select lives_ok(
  $$select public.set_my_group_notification_preferences(
      '20000000-0000-0000-0000-000000000003', 'none', true, true
    )$$,
  'a member can disable ordinary group content notifications'
);
select is(
  (select row(notification_level, content_push_enabled, new_post_push_enabled)::text
   from public.group_memberships
   where group_id = '20000000-0000-0000-0000-000000000003'
     and profile_id = private.current_profile_id()),
  '(none,f,f)',
  'the RPC disables both Push settings when the inbox level is none'
);

reset role;
select throws_ok(
  $$update public.group_memberships
    set content_push_enabled = true
    where group_id = '20000000-0000-0000-0000-000000000003'
      and profile_id = (select id from public.profiles where pub_id = 'hanbyeol-25')$$,
  '23514', null,
  'group content Push cannot be enabled when inbox notifications are disabled'
);
select throws_ok(
  $$update public.group_memberships
    set new_post_push_enabled = true
    where group_id = '20000000-0000-0000-0000-000000000003'
      and profile_id = (select id from public.profiles where pub_id = 'hanbyeol-25')$$,
  '23514', null,
  'new post Push cannot be enabled without all inbox notifications'
);
set local role authenticated;

select lives_ok(
  $$select public.register_my_web_push_subscription(
      'https://push.example.test/subscription/one',
      'BNcRdreALRFXTkA0bP8M5bq6fP6w6uLqFhKxqv2QdA',
      'dGVzdC1hdXRoLWtleQ',
      1893456000000
    )$$,
  'a caller can register the current browser subscription'
);
reset role;
select is(
  (select expiration_time
   from private.web_push_subscriptions
   where endpoint = 'https://push.example.test/subscription/one'),
  '2030-01-01 00:00:00+00'::timestamptz,
  'registration persists PushSubscription.expirationTime'
);
set local role authenticated;
select ok(
  (select subscribed from public.get_my_web_push_status(
    'https://push.example.test/subscription/one'
  )),
  'push status confirms a registered endpoint without returning its keys'
);
select is(
  public.unregister_my_web_push_subscription('https://push.example.test/subscription/one'),
  true,
  'a caller can unregister its endpoint'
);
select ok(
  not (select subscribed from public.get_my_web_push_status(
    'https://push.example.test/subscription/one'
  )),
  'push status becomes false after unregistering'
);

-- 알림함 한 행이 "어느 그룹 소식인가"를 말하려면 이름이 목록 RPC에서 나와야 한다.
-- 그룹이 없는 계정 알림은 이름 자리를 비운 채로 같은 페이지에 섞여 나온다.
reset role;
insert into public.notifications (
  id, recipient_profile_id, kind, importance, category, actor_identity,
  actor_profile_id, actor_display_name, group_id, title, created_at, last_activity_at
)
values (
  '70000000-0000-0000-0000-000000000003',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'account_approved', 'high', 'account', 'staff',
  null, '운영진', null, '가입이 승인되었습니다.', now(), now()
);
set local role authenticated;

select is(
  (select notification.group_name
   from public.list_my_notifications(null, null, 20) as notification
   where notification.id = '70000000-0000-0000-0000-000000000001'),
  '메이커스 랩',
  'the list RPC names the group a notification came from'
);
select is(
  (select notification.group_name
   from public.list_my_notifications(null, null, 20) as notification
   where notification.id = '70000000-0000-0000-0000-000000000003'),
  null::text,
  'a notification with no group carries no group name'
);

reset role;
select * from finish();
rollback;
