begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

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

set local role authenticated;
with join_request as (
  insert into public.group_join_requests (group_id, profile_id)
  values (
    '20000000-0000-0000-0000-000000000006',
    private.current_profile_id()
  )
  returning id
)
insert into producer_ids
select 'join_request', id from join_request;
reset role;
select ok(
  exists (
    select 1 from public.notifications
    where kind = 'group_join_requested'
      and group_id = '20000000-0000-0000-0000-000000000006'
  ),
  'a pending join request notifies group administrators'
);
set local role authenticated;
delete from public.group_join_requests
where id = (select id from producer_ids where name = 'join_request');
reset role;
select ok(
  not exists (
    select 1 from public.notifications
    where kind = 'group_join_requested'
      and group_id = '20000000-0000-0000-0000-000000000006'
  ),
  'canceling a join request removes its stale administrator notifications'
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

-- 알림함이 "어느 그룹 소식인가"를 말할 수 있는지 확인한다. 그룹 게시물에 달린 댓글과 반응은
-- 게시물의 그룹을 물려받고, 프로필 타임라인 글은 그룹이 없으므로 이름 자리가 비어야 한다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
insert into producer_ids values (
  'timeline_post',
  public.create_profile_post('kim-admin', 'public')
);
select public.commit_profile_post(
  (select id from producer_ids where name = 'timeline_post'),
  '타임라인 알림 글', '{}'::uuid[], true
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is(
  (select notification.group_name
   from public.list_my_notifications(null, null, 50) as notification
   where notification.kind = 'post_commented'),
  '메이커스 랩',
  'a comment on a group post names the group it came from'
);
select is(
  (select notification.group_name
   from public.list_my_notifications(null, null, 50) as notification
   where notification.kind = 'post_reacted'),
  '메이커스 랩',
  'a reaction on a group post names the group it came from'
);
select is(
  (select notification.group_name
   from public.list_my_notifications(null, null, 50) as notification
   where notification.kind = 'timeline_posted'),
  null::text,
  'a profile timeline post carries no group name'
);
reset role;

-- 운영 조치 알림은 "무엇이 삭제되었는지"를 말해야 한다. 삭제된 대상은 다시 열어볼 수 없어서
-- 알림이 대상을 밝히지 않으면 작성자는 영영 알 수 없다. 다만 댓글 원문은 싣지 않는다
-- (기능 명세 §14.8) -- 알림 제목이 곧 잠금 화면 Push 본문이 되기 때문이다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select public.delete_group_post((select id from producer_ids where name = 'group_post'));
select public.delete_post_comment((select id from producer_ids where name = 'comment'));
reset role;

select is(
  (select title from public.notifications
   where kind = 'post_moderated'
     and recipient_profile_id = (select id from public.profiles where pub_id = 'hanbyeol-25')),
  '“알림 그룹 글” 게시물이 운영자에 의해 삭제되었습니다.',
  'post moderation names the post that was removed'
);
select is(
  (select title from public.notifications
   where kind = 'comment_moderated'
     and recipient_profile_id = (select id from public.profiles where pub_id = 'hanbyeol-25')),
  '“이번 주 프로젝트 일정” 게시물에 남긴 내 댓글이 운영자에 의해 삭제되었습니다.',
  'comment moderation names the post the removed comment was on'
);
select ok(
  (select title not like '%알림 댓글%' from public.notifications
   where kind = 'comment_moderated'
     and recipient_profile_id = (select id from public.profiles where pub_id = 'hanbyeol-25')),
  'comment moderation never carries the deleted comment text'
);

select * from finish();
rollback;
