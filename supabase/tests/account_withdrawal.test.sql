begin;

create extension if not exists pgtap with schema extensions;
select plan(49);

-- 탈퇴할 승인 학생을 새로 만든다. 홍길동(…001)은 그 사람과 대화하고 알림을 받은 다른 회원이다.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000201',
  'authenticated', 'authenticated', 'withdraw-test@kmla.hs.kr', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.profiles (
  auth_user_id, pub_id, name, type, student_number, cohort, gender, academic_track,
  birthday, phone_number, description, anonymous_username, avatar_path, cover_path, status
) values (
  '10000000-0000-0000-0000-000000000201', 'leaving-student', '떠날학생', 'student', '260201', 31,
  'female', 'domestic', '2009-03-01', '010-1234-5678', '안녕하세요', '익명고양이',
  '10000000-0000-0000-0000-000000000201/avatar/a0000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000201/cover/a0000000-0000-0000-0000-000000000002',
  'accepted'
);

select set_config('test.me', (select id::text from public.profiles where pub_id = 'leaving-student'), true);
select set_config('test.hong', (select id::text from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001'), true);
select set_config('test.group', (select id::text from public.groups where slug = 'makers-lab'), true);
select set_config('test.other_group', (select id::text from public.groups where slug = 'b41f6d2e8a0c97'), true);

create function pg_temp.act_as_me(password_age interval) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '10000000-0000-0000-0000-000000000201',
      'amr', jsonb_build_array(jsonb_build_object(
        'method', 'password', 'timestamp', extract(epoch from now() - password_age)
      ))
    )::text,
    true
  );
$$;
grant execute on function pg_temp.act_as_me(interval) to authenticated;

-- 거부
select pg_temp.act_as_me(interval '6 minutes');
set local role authenticated;
select throws_ok(
  $$select public.withdraw_account()$$,
  '42501', 'recent password authentication required',
  'withdrawal requires recent password authentication'
);
reset role;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003',
  'authenticated', 'authenticated', 'blocked-withdraw@kmla.hs.kr', '', now(), now());
update public.profiles set auth_user_id = '10000000-0000-0000-0000-000000000003' where pub_id = 'blocked-user';
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '10000000-0000-0000-0000-000000000003',
    'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())))
  )::text,
  true
);
set local role authenticated;
select throws_ok(
  $$select public.withdraw_account()$$,
  '42501', 'accepted profile required',
  'a blocked account cannot withdraw by itself'
);
reset role;

insert into public.group_memberships (group_id, profile_id, role)
values (current_setting('test.group')::uuid, current_setting('test.me')::bigint, 'member');
update public.group_memberships set role = 'admin'
where group_id = current_setting('test.group')::uuid and role = 'owner';
update public.group_memberships set role = 'owner'
where group_id = current_setting('test.group')::uuid and profile_id = current_setting('test.me')::bigint;
select pg_temp.act_as_me(interval '0 minutes');
set local role authenticated;
select throws_ok(
  $$select public.withdraw_account()$$,
  '22023', 'group ownership must be transferred before withdrawal',
  'a group owner must transfer ownership first'
);
reset role;
update public.group_memberships set role = 'member'
where group_id = current_setting('test.group')::uuid and profile_id = current_setting('test.me')::bigint;
update public.group_memberships as membership set role = 'owner'
from public.profiles as profile
where membership.group_id = current_setting('test.group')::uuid
  and profile.id = membership.profile_id and profile.pub_id = 'kim-admin';

update public.profiles set role = 'admin' where id = current_setting('test.me')::bigint;
set local role authenticated;
select throws_ok(
  $$select public.withdraw_account()$$,
  '22023', 'app administrator role must be released before withdrawal',
  'an app administrator must be demoted first'
);
reset role;
update public.profiles set role = 'member' where id = current_setting('test.me')::bigint;

-- 탈퇴 전 상태. 정지 중이어도 탈퇴는 막지 않는다.
insert into private.profile_suspensions (profile_id, reason, expires_at)
values (current_setting('test.me')::bigint, '테스트 정지 사유', now() + interval '3 days');
insert into private.group_anonymous_activity_restrictions (group_id, profile_id, reason, expires_at, source_kind)
values (current_setting('test.group')::uuid, current_setting('test.me')::bigint, '테스트 제한 사유', now() + interval '3 days', 'post');
insert into public.group_join_requests (group_id, profile_id)
values (current_setting('test.other_group')::uuid, current_setting('test.me')::bigint);
insert into private.group_invites (group_id, token, created_by, expires_at)
values (current_setting('test.group')::uuid, md5('withdraw-test-invite'), current_setting('test.me')::bigint, now() + interval '1 day');
insert into public.user_timetables (profile_id) values (current_setting('test.me')::bigint);
insert into public.notification_preferences (profile_id) values (current_setting('test.me')::bigint);
insert into private.web_push_subscriptions (profile_id, endpoint, p256dh, auth)
values (current_setting('test.me')::bigint, 'https://push.example/withdraw', repeat('p', 30), repeat('a', 16));
insert into public.profile_permissions (profile_id, permission_key)
select current_setting('test.me')::bigint, permission.key from public.permissions as permission limit 1;
insert into private.feed_sessions (profile_id, feed_epoch, expires_at)
values (current_setting('test.me')::bigint, now(), now() + interval '1 day');
insert into public.stories (profile_id, status, content, background, image_path, thumbnail_path,
  image_size_bytes, image_width, image_height, published_at, expires_at)
values (current_setting('test.me')::bigint, 'ready', '', null,
  '10000000-0000-0000-0000-000000000201/b0000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000201/b0000000-0000-0000-0000-000000000002',
  1000, 100, 100, now(), now() + interval '1 day');
-- 예약 규칙 트리거는 지난 날짜와 남의 예약을 거부하므로 잠시 꺼 두고 지난 예약을 직접 넣는다.
alter table public.utility_reservations disable trigger utility_reservations_prepare;
insert into public.utility_reservations (profile_id, mode, reservation_date, slot, location, detail, applicant_name)
values (current_setting('test.me')::bigint, 'gongang', current_date - 3, 'study-2', 'floor_b1', '지난 예약', '떠날학생');
alter table public.utility_reservations enable trigger utility_reservations_prepare;
insert into public.profile_media_objects (id, profile_id, auth_user_id, slot, object_path, size_bytes, width, height, status, ready_at)
values
  ('a0000000-0000-0000-0000-000000000001', current_setting('test.me')::bigint, '10000000-0000-0000-0000-000000000201', 'avatar',
   '10000000-0000-0000-0000-000000000201/avatar/a0000000-0000-0000-0000-000000000001', 1000, 512, 512, 'ready', now()),
  ('a0000000-0000-0000-0000-000000000002', current_setting('test.me')::bigint, '10000000-0000-0000-0000-000000000201', 'cover',
   '10000000-0000-0000-0000-000000000201/cover/a0000000-0000-0000-0000-000000000002', 1000, 1500, 500, 'ready', now());

-- 내 타임라인 글(내가 쓴 글과 홍길동이 써 준 글)과 그룹에 쓴 글
insert into public.posts (id, kind, body, timeline_profile_id, author_identity, display_author_profile_id, visibility, published_at)
values
  ('e0000000-0000-0000-0000-000000000001', 'profile', '내 타임라인 글', current_setting('test.me')::bigint,
   'identified', current_setting('test.me')::bigint, 'public', now()),
  ('e0000000-0000-0000-0000-000000000002', 'profile', '홍길동이 남긴 글', current_setting('test.me')::bigint,
   'identified', current_setting('test.hong')::bigint, 'public', now());
insert into public.posts (id, kind, body, group_id, title, author_identity, display_author_profile_id, published_at)
values ('e0000000-0000-0000-0000-000000000003', 'group', '그룹 글', current_setting('test.group')::uuid,
  '남는 글', 'identified', current_setting('test.me')::bigint, now());
insert into private.post_authors (post_id, profile_id)
values
  ('e0000000-0000-0000-0000-000000000001', current_setting('test.me')::bigint),
  ('e0000000-0000-0000-0000-000000000002', current_setting('test.hong')::bigint),
  ('e0000000-0000-0000-0000-000000000003', current_setting('test.me')::bigint);
insert into public.post_reactions (post_id, profile_id, reaction)
values ('e0000000-0000-0000-0000-000000000003', current_setting('test.me')::bigint, 'like');
insert into private.group_post_reports (post_id, reporter_profile_id, reason)
values ('e0000000-0000-0000-0000-000000000003', current_setting('test.me')::bigint, 'spam');

-- 받은 알림과 홍길동이 받은, 내가 행위자인 알림
insert into public.notifications (recipient_profile_id, kind, importance, category, actor_identity, title)
values (current_setting('test.me')::bigint, 'account_approved', 'normal', 'account', 'system', '가입이 승인되었습니다.');
insert into public.notifications (
  recipient_profile_id, kind, importance, category, actor_identity, actor_profile_id,
  actor_display_name, actor_avatar_path, title
) values (
  current_setting('test.hong')::bigint, 'post_reacted', 'low', 'content', 'identified',
  current_setting('test.me')::bigint, '떠날학생',
  '10000000-0000-0000-0000-000000000201/avatar/a0000000-0000-0000-0000-000000000001',
  '떠날학생님이 반응했습니다.'
);

-- 그룹 대화(내가 만든 방)와 1:1 대화
insert into public.conversations (id, type, name, created_by)
values ('f0000000-0000-0000-0000-000000000001', 'group', '떠나는 방', current_setting('test.me')::bigint);
insert into public.conversations (id, type, created_by, direct_profile_low, direct_profile_high)
values ('f0000000-0000-0000-0000-000000000002', 'direct', current_setting('test.me')::bigint,
  least(current_setting('test.me')::bigint, current_setting('test.hong')::bigint),
  greatest(current_setting('test.me')::bigint, current_setting('test.hong')::bigint));
insert into public.conversation_members (conversation_id, profile_id)
values
  ('f0000000-0000-0000-0000-000000000001', current_setting('test.me')::bigint),
  ('f0000000-0000-0000-0000-000000000001', current_setting('test.hong')::bigint),
  ('f0000000-0000-0000-0000-000000000002', current_setting('test.me')::bigint),
  ('f0000000-0000-0000-0000-000000000002', current_setting('test.hong')::bigint);

-- 진행 중인 회차와 이미 마감한 회차의 기부물품 신청
insert into public.donation_rounds (id, title, opens_at, closes_at)
overriding system value
values
  (900001, '진행 중 회차', now() - interval '1 day', now() + interval '1 day'),
  (900002, '마감한 회차', now() - interval '3 days', now() - interval '1 day');
insert into public.donation_items (id, round_id, category, name, source_sheet, source_row)
overriding system value
values
  (900001, 900001, '도서', '진행 중 물품', 'sheet', 1),
  (900002, 900002, '도서', '마감 물품', 'sheet', 2);
insert into public.donation_claims (item_id, profile_id, created_at)
values
  (900001, current_setting('test.me')::bigint, now() - interval '1 hour'),
  (900002, current_setting('test.me')::bigint, now() - interval '2 days');

-- 진행 중인 정리 실행이 없어야 탈퇴가 워커를 깨우는지 볼 수 있다.
delete from private.storage_cleanup_runs;

-- 탈퇴
select pg_temp.act_as_me(interval '1 minute');
set local role authenticated;
select lives_ok($$select public.withdraw_account()$$, 'an accepted member can withdraw even while suspended');
reset role;

-- 계정과 프로필
select is(
  (select count(*)::int from auth.users where id = '10000000-0000-0000-0000-000000000201'),
  0, 'the auth account is deleted'
);
select results_eq(
  $$select status::text, deleted_at is not null, auth_user_id is null, role::text
    from public.profiles where id = current_setting('test.me')::bigint$$,
  $$values ('withdrawn', true, true, 'member')$$,
  'the profile row stays as a withdrawn tombstone'
);
select is(
  (select array[student_number, cohort::text, gender::text, academic_track::text, birthday::text,
    phone_number, description, anonymous_username, avatar_path, cover_path, contact_email, department,
    class_no::text, dorm_room::text]
   from public.profiles where id = current_setting('test.me')::bigint),
  array[null, null, null, null, null, null, null, null, null, null, null, null, null, null]::text[],
  'identifying profile fields are cleared'
);
select isnt(
  (select name from public.profiles where id = current_setting('test.me')::bigint),
  '떠날학생', 'the real name is overwritten'
);
select isnt(
  (select pub_id from public.profiles where id = current_setting('test.me')::bigint),
  'leaving-student', 'the self-chosen public ID is replaced'
);
select results_eq(
  $$select item_id, cancelled_at is not null from public.donation_claims
    where profile_id = current_setting('test.me')::bigint order by item_id$$,
  $$values (900001::bigint, true), (900002::bigint, false)$$,
  'only claims in an open donation round are cancelled'
);

-- 지워지는 것
select is((select count(*)::int from public.group_memberships where profile_id = current_setting('test.me')::bigint), 0, 'group memberships are removed');
select is((select count(*)::int from public.group_join_requests where profile_id = current_setting('test.me')::bigint), 0, 'group join requests are removed');
select is((select count(*)::int from private.group_invites where created_by = current_setting('test.me')::bigint), 0, 'invites created by the account are revoked');
select is((select count(*)::int from public.user_timetables where profile_id = current_setting('test.me')::bigint), 0, 'the timetable is deleted');
select is((select count(*)::int from public.notification_preferences where profile_id = current_setting('test.me')::bigint), 0, 'notification preferences are deleted');
select is((select count(*)::int from private.web_push_subscriptions where profile_id = current_setting('test.me')::bigint), 0, 'push subscriptions are deleted');
select is((select count(*)::int from public.notifications where recipient_profile_id = current_setting('test.me')::bigint), 0, 'received notifications are deleted');
select is((select count(*)::int from public.profile_permissions where profile_id = current_setting('test.me')::bigint), 0, 'feature permissions are revoked');
select is((select count(*)::int from private.feed_sessions where profile_id = current_setting('test.me')::bigint), 0, 'feed sessions are deleted');
select is((select count(*)::int from public.stories where profile_id = current_setting('test.me')::bigint), 0, 'stories are deleted');
select is((select count(*)::int from public.utility_reservations where profile_id = current_setting('test.me')::bigint), 0, 'reservations, past ones included, are deleted');
select is((select count(*)::int from private.group_post_reports where reporter_profile_id = current_setting('test.me')::bigint), 0, 'reports filed by the account are deleted');
select is((select count(*)::int from private.profile_suspensions where profile_id = current_setting('test.me')::bigint), 0, 'suspension records are deleted');
select is((select count(*)::int from private.group_anonymous_activity_restrictions where profile_id = current_setting('test.me')::bigint), 0, 'anonymous activity restrictions are deleted');
select is((select count(*)::int from public.profile_media_objects where profile_id = current_setting('test.me')::bigint), 0, 'profile media rows are deleted');
select is(
  (select count(*)::int from public.posts where timeline_profile_id = current_setting('test.me')::bigint),
  0, 'every post on the withdrawn timeline is deleted, including ones others wrote'
);
select set_eq(
  $$select bucket, object_path from private.storage_cleanup_queue
    where object_path like '10000000-0000-0000-0000-000000000201/%'$$,
  $$values
    ('profile-media', '10000000-0000-0000-0000-000000000201/avatar/a0000000-0000-0000-0000-000000000001'),
    ('profile-media', '10000000-0000-0000-0000-000000000201/cover/a0000000-0000-0000-0000-000000000002'),
    ('story-media', '10000000-0000-0000-0000-000000000201/b0000000-0000-0000-0000-000000000001'),
    ('story-media', '10000000-0000-0000-0000-000000000201/b0000000-0000-0000-0000-000000000002')$$,
  'profile and story objects are queued for storage cleanup'
);
select ok(
  exists (select 1 from private.storage_cleanup_runs where started_at = now()),
  'withdrawal wakes the storage cleanup worker after queueing profile and story media'
);
select results_eq(
  $$select actor_profile_id, actor_display_name, actor_avatar_path
    from public.notifications where recipient_profile_id = current_setting('test.hong')::bigint
      and kind = 'post_reacted' and title = '떠날학생님이 반응했습니다.'$$,
  $$values (current_setting('test.me')::bigint, null::text, null::text)$$,
  'name and avatar copies in other members'' notifications are cleared'
);

-- 남는 것
select is((select count(*)::int from public.posts where id = 'e0000000-0000-0000-0000-000000000003'), 1, 'group posts remain');
select is((select count(*)::int from private.post_authors where post_id = 'e0000000-0000-0000-0000-000000000003' and profile_id = current_setting('test.me')::bigint), 1, 'the real author record of a group post remains');
select is((select count(*)::int from public.post_reactions where profile_id = current_setting('test.me')::bigint), 1, 'reactions remain');

-- 대화
select ok(
  (select left_at is not null from public.conversation_members
   where conversation_id = 'f0000000-0000-0000-0000-000000000001' and profile_id = current_setting('test.me')::bigint),
  'the withdrawn account leaves group conversations'
);
select is(
  (select created_by from public.conversations where id = 'f0000000-0000-0000-0000-000000000001'),
  current_setting('test.hong')::bigint,
  'group conversation ownership passes to the earliest remaining member'
);
select is(
  (select system_profile_ids from private.messages
   where conversation_id = 'f0000000-0000-0000-0000-000000000001' and system_kind = 'member_left'),
  array[current_setting('test.me')::bigint],
  'other members see that the account left'
);
select results_eq(
  $$select profile_id, left_at is null from public.conversation_members
    where conversation_id = 'f0000000-0000-0000-0000-000000000002' order by profile_id$$,
  $$select profile.id, profile.id = current_setting('test.hong')::bigint
    from public.profiles as profile
    where profile.id in (current_setting('test.me')::bigint, current_setting('test.hong')::bigint)
    order by profile.id$$,
  'the direct conversation stays for the other member while the withdrawn account leaves it'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.send_message('f0000000-0000-0000-0000-000000000002', gen_random_uuid(), '안녕?')$$,
  '42501', 'recipient withdrawn',
  'nobody can send a new direct message to a withdrawn account'
);
select throws_ok(
  $$select * from public.prepare_message_attachments(
    'f0000000-0000-0000-0000-000000000002', gen_random_uuid(),
    '[{"kind":"file","mime_type":"application/pdf","file_name":"a.pdf","size_bytes":10}]'::jsonb
  )$$,
  '42501', 'recipient withdrawn',
  'attachments cannot be prepared for a withdrawn counterpart either'
);
select lives_ok(
  $$select * from public.send_message('f0000000-0000-0000-0000-000000000001', gen_random_uuid(), '잘 가')$$,
  'group conversations the account left keep working'
);
select is(
  (select participant - 'avatar_path' - 'active'
   from public.list_conversations('f0000000-0000-0000-0000-000000000002') as conversation,
     jsonb_array_elements(conversation.participants) as participant
   where (participant ->> 'id')::bigint = current_setting('test.me')::bigint),
  jsonb_build_object(
    'id', current_setting('test.me')::bigint, 'pub_id', null,
    'name', '탈퇴한 사용자', 'withdrawn', true
  ),
  'the direct conversation shows the counterpart as withdrawn without a profile link'
);
reset role;

select is(
  private.emit_notification(
    'withdrawn-recipient-test', current_setting('test.me')::bigint, 'post_reacted', 'low', 'content',
    'identified', current_setting('test.hong')::bigint, '홍길동', null, '반응했습니다.'
  ),
  null, 'no notification is created for a withdrawn account'
);

-- 두 번째 탈퇴는 계정이 없으므로 거부된다
select pg_temp.act_as_me(interval '0 minutes');
set local role authenticated;
select throws_ok(
  $$select public.withdraw_account()$$,
  '42501', 'accepted profile required',
  'a withdrawn account cannot withdraw again'
);
reset role;

-- 권한
select is(
  has_function_privilege('anon', 'public.withdraw_account()', 'execute'),
  false, 'anonymous visitors cannot call withdrawal'
);
select is(
  has_function_privilege('authenticated', 'public.withdraw_account()', 'execute'),
  true, 'signed-in users can call withdrawal'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.withdraw_account()'::regprocedure),
  true, 'withdrawal runs as definer to delete the auth account'
);

-- 차단된 사용자는 RPC를 거치지 않으면 다른 정보도 그대로다
select is(
  (select status::text from public.profiles where pub_id = 'blocked-user'),
  'blocked', 'a refused withdrawal changes nothing'
);
select is(
  (select count(*)::int from public.group_memberships where profile_id = current_setting('test.hong')::bigint) > 0,
  true, 'other members keep their memberships'
);
select is(
  (select count(*)::int from public.posts where id = 'e0000000-0000-0000-0000-000000000003' and display_author_profile_id = current_setting('test.me')::bigint),
  1, 'the group post still points at the tombstone so reads show 탈퇴한 사용자'
);

select * from finish();
rollback;
