begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000', user_id, 'authenticated',
  'authenticated', email, '', now(), '{}', '{}', now(), now()
from (values
  ('10000000-0000-0000-0000-000000000002'::uuid, 'producer-admin@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000003'::uuid, 'producer-a@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000004'::uuid, 'producer-b@kmla.hs.kr')
) as users(user_id, email);

update public.profiles
set auth_user_id = case pub_id
  when 'kim-admin' then '10000000-0000-0000-0000-000000000002'::uuid
  when 'hanbyeol-25' then '10000000-0000-0000-0000-000000000003'::uuid
  when 'saebyeok-24' then '10000000-0000-0000-0000-000000000004'::uuid
end
where pub_id in ('kim-admin', 'hanbyeol-25', 'saebyeok-24');

update public.group_memberships
set notification_level = 'all'
where group_id = '20000000-0000-0000-0000-000000000003';
delete from public.notifications;
delete from private.notification_event_keys;

create temp table producer_ids (name text primary key, id uuid);
grant select, insert on producer_ids to authenticated;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
insert into producer_ids
select 'comment', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000001', '알림 댓글', 'identified'
);
reset role;

select is(
  (select kind from public.notifications where comment_id = (select id from producer_ids where name = 'comment')),
  'post_commented'::public.notification_kind,
  'a comment notifies the post author'
);
select is(
  (select count(*) from public.notifications where recipient_profile_id = (select id from public.profiles where pub_id = 'hanbyeol-25')),
  0::bigint,
  'comment authors do not notify themselves'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
insert into producer_ids
select 'reply', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000001', '알림 답글', 'identified',
  (select id from producer_ids where name = 'comment')
);
reset role;
select is(
  (select kind from public.notifications where comment_id = (select id from producer_ids where name = 'reply')),
  'comment_replied'::public.notification_kind,
  'a reply emits only the specific reply notification'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select public.set_my_group_notification_preferences(
  '20000000-0000-0000-0000-000000000003', 'none', false, false
);
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
insert into producer_ids
select 'muted_reply', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000001', '수신 거부 답글', 'identified',
  (select id from producer_ids where name = 'comment')
);
reset role;
select ok(
  not exists (
    select 1 from public.notifications
    where comment_id = (select id from producer_ids where name = 'muted_reply')
  ),
  'the none level suppresses ordinary group-content notifications in-app'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select * from public.set_post_reaction('90000000-0000-0000-0000-000000000001', 'like');
select * from public.clear_post_reaction('90000000-0000-0000-0000-000000000001');
select * from public.set_post_reaction('90000000-0000-0000-0000-000000000001', 'love');
reset role;
select is(
  (select count(*) from public.notifications where kind = 'post_reacted'),
  1::bigint,
  'reaction changes, removal, and re-addition remain one actor event'
);
select is(
  (select actor_count from public.notifications where kind = 'post_reacted'),
  1,
  'a repeated reacting actor is not double counted'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
insert into producer_ids values (
  'group_post',
  public.create_group_post(
    '20000000-0000-0000-0000-000000000003', '알림 그룹 글', '본문', 'identified'
  )
);
reset role;
select ok(
  exists (
    select 1 from public.notifications
    where kind = 'group_posted'
      and post_id = (select id from producer_ids where name = 'group_post')
      and recipient_profile_id = (select id from public.profiles where pub_id = 'kim-admin')
  ),
  'new group posts fan out to all-level members'
);
select ok(
  not exists (
    select 1 from public.notifications
    where kind = 'group_posted'
      and post_id = (select id from producer_ids where name = 'group_post')
      and recipient_profile_id = (select id from public.profiles where pub_id = 'hanbyeol-25')
  ),
  'new group post fanout excludes its author'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select * from public.admin_set_gongang_manager(
  (select id from public.profiles where pub_id = 'saebyeok-24'), true
);
reset role;
select ok(
  exists (
    select 1 from public.notifications
    where kind = 'gongang_manager_granted'
      and recipient_profile_id = (select id from public.profiles where pub_id = 'saebyeok-24')
  ),
  'permission administration notifies the affected user'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
insert into public.utility_reservations (
  profile_id, mode, reservation_date, slot, location, detail, recurring, applicant_name
) values (
  0, 'gongang', (now() at time zone 'Asia/Seoul')::date,
  'study-2', 'floor_10', '장기 예약', true, ''
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
insert into public.gongang_schedule (schedule_date, slot, location, reserved, detail)
values (
  (now() at time zone 'Asia/Seoul')::date + 7,
  'study-2', 'floor_10', true, '관리자 선예약'
);
reset role;
select ok(
  exists (
    select 1 from public.notifications
    where kind = 'gongang_preempted'
      and recipient_profile_id = (select id from public.profiles where pub_id = 'hanbyeol-25')
  ),
  'manager preemption notifies the recurring reservation owner'
);
select is(
  (
    select recurring_until
    from public.utility_reservations
    where slot = 'study-2' and location = 'floor_10'
  ),
  (now() at time zone 'Asia/Seoul')::date + 7,
  'preemption notification is committed with the reservation cutoff'
);

select * from finish();
rollback;
