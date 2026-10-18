begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

-- 한 댓글에 달린 답글은 알림 한 행으로 모은다(기능 명세 §14.9). 인원은 서로 다른 작성자 수이고,
-- 같은 사람의 실명·익명 답글은 다른 사람으로 센다. Push는 답글마다 따로 보낸다.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000', user_id, 'authenticated',
  'authenticated', email, '', now(), '{}', '{}', now(), now()
from (values
  ('10000000-0000-0000-0000-000000000002'::uuid, 'reply-admin@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000003'::uuid, 'reply-parent@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000004'::uuid, 'reply-b@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000005'::uuid, 'reply-c@kmla.hs.kr')
) as users(user_id, email);

update public.profiles
set auth_user_id = case pub_id
  when 'kim-admin' then '10000000-0000-0000-0000-000000000002'::uuid
  when 'hanbyeol-25' then '10000000-0000-0000-0000-000000000003'::uuid
  when 'saebyeok-24' then '10000000-0000-0000-0000-000000000004'::uuid
  when 'pureum-23' then '10000000-0000-0000-0000-000000000005'::uuid
end
where pub_id in ('kim-admin', 'hanbyeol-25', 'saebyeok-24', 'pureum-23');

delete from public.notifications;
delete from private.notification_event_keys;

insert into private.web_push_subscriptions (
  id, profile_id, endpoint, p256dh, auth, created_at
) values (
  '71000000-0000-0000-0000-000000000101',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'https://push.example.test/replies',
  'BNcRdreALRFXTkA0bP8M5bq6fP6w6uLqFhKxqv2QdA',
  'dGVzdC1hdXRoLWtleQ',
  now() - interval '1 hour'
);

create temp table reply_ids (name text primary key, id uuid);
grant select, insert on reply_ids to authenticated;

-- 한 트랜잭션 안의 답글은 created_at이 모두 같다. 실제로는 답글마다 트랜잭션이 따로라 순서가
-- 분명하므로, 새 답글을 달기 전에 앞선 답글을 과거로 옮겨 그 순서를 재현한다.
alter table public.post_comments disable trigger post_comments_prevent_immutable_changes;
create function pg_temp.age_replies() returns void
language sql
as $$
  update public.post_comments
  set created_at = created_at - interval '1 minute'
  where parent_comment_id = (select id from reply_ids where name = 'parent');
$$;

create function pg_temp.reply_notification() returns setof public.notifications
language sql stable
as $$
  select notification.* from public.notifications as notification
  where notification.kind = 'comment_replied'
    and notification.recipient_profile_id = (select id from public.profiles where pub_id = 'hanbyeol-25');
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
insert into reply_ids
select 'parent', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000001', '부모 댓글', 'identified'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
insert into reply_ids
select 'b_first', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000001', 'B의 첫 답글', 'identified',
  (select id from reply_ids where name = 'parent')
);
reset role;
select pg_temp.age_replies();
set local role authenticated;
insert into reply_ids
select 'b_second', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000001', 'B의 두 번째 답글', 'identified',
  (select id from reply_ids where name = 'parent')
);
reset role;

select is(
  (select count(*) from public.notifications where kind = 'comment_replied'),
  1::bigint,
  'replies to the same comment share one notification'
);
select is(
  (select actor_count from pg_temp.reply_notification()),
  1,
  'repeated replies by one person count that person once'
);
select is(
  (select comment_id from pg_temp.reply_notification()),
  (select id from reply_ids where name = 'b_second'),
  'the notification points at the latest reply'
);

select pg_temp.age_replies();
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
set local role authenticated;
insert into reply_ids
select 'c_anonymous', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000001', 'C의 익명 답글', 'anonymous',
  (select id from reply_ids where name = 'parent')
);
reset role;

select is(
  (select actor_count from pg_temp.reply_notification()),
  2,
  'a different replier joins the count'
);
select ok(
  (
    select actor_identity = 'anonymous' and actor_profile_id is null
      and actor_display_name = '익명' and actor_avatar_path is null
    from pg_temp.reply_notification()
  ),
  'an anonymous latest reply shows no identity'
);

select pg_temp.age_replies();
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
insert into reply_ids
select 'b_anonymous', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000001', 'B의 익명 답글', 'anonymous',
  (select id from reply_ids where name = 'parent')
);
reset role;

select is(
  (select actor_count from pg_temp.reply_notification()),
  3,
  'identified and anonymous replies by one person count as different repliers'
);
select is(
  (
    select count(*) from private.notification_delivery_outbox
    where notification_id = (select id from pg_temp.reply_notification())
      and channel = 'web_push'
  ),
  4::bigint,
  'every aggregated reply queues its own push'
);
select is(
  (
    select count(distinct notification_event_key) from private.notification_delivery_outbox
    where notification_id = (select id from pg_temp.reply_notification())
  ),
  4::bigint,
  'each queued push records the reply that caused it'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select public.resolve_my_notification_destination((select id from pg_temp.reply_notification()));
reset role;
select ok(
  (select read_at is not null from pg_temp.reply_notification()),
  'opening the notification marks it read'
);

-- 알림이 생긴 뒤에 등록한 기기도 그 뒤의 답글 Push는 받아야 한다. 같은 트랜잭션에서는 시각이 모두
-- 같으므로 알림을 먼저 생긴 것으로 옮겨 그 순서를 만든다.
update public.notifications
set created_at = now() - interval '2 hours'
where id = (select id from pg_temp.reply_notification());
insert into private.web_push_subscriptions (
  id, profile_id, endpoint, p256dh, auth, created_at
) values (
  '71000000-0000-0000-0000-000000000102',
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'https://push.example.test/later-device',
  'BNcRdreALRFXTkA0bP8M5bq6fP6w6uLqFhKxqv2QdA',
  'dGVzdC1hdXRoLWtleQ',
  now()
);

select pg_temp.age_replies();
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
set local role authenticated;
insert into reply_ids
select 'c_identified', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000001', 'C의 실명 답글', 'identified',
  (select id from reply_ids where name = 'parent')
);
reset role;

select ok(
  (select read_at is null from pg_temp.reply_notification()),
  'a new reply returns the notification to unread'
);
select ok(
  (
    select actor_identity = 'identified'
      and actor_profile_id = (select id from public.profiles where pub_id = 'pureum-23')
      and actor_count = 4
    from pg_temp.reply_notification()
  ),
  'an identified latest reply shows its author'
);
select is(
  (
    select notification_event_key from private.notification_delivery_outbox
    where subscription_id = '71000000-0000-0000-0000-000000000102'
  ),
  'comment:' || (select id from reply_ids where name = 'c_identified')::text,
  'a device registered after the notification gets pushes for later replies'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select is(
  (
    select comment_excerpt from public.list_my_notifications(null, null, 20)
    where kind = 'comment_replied'
  ),
  'C의 실명 답글',
  'the inbox shows the latest reply text'
);
reset role;

-- 지운 답글 하나 때문에 다른 답글의 알림까지 사라지면 안 된다. 남은 답글로 다시 맞춘다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select public.delete_post_comment((select id from reply_ids where name = 'c_identified'));
reset role;

select is(
  (select comment_id from pg_temp.reply_notification()),
  (select id from reply_ids where name = 'b_anonymous'),
  'deleting the latest reply falls back to the previous reply'
);
select ok(
  (
    select actor_identity = 'anonymous' and actor_profile_id is null and actor_count = 3
    from pg_temp.reply_notification()
  ),
  'the fallback recounts repliers and shows the remaining reply author'
);
select ok(
  not exists (
    select 1 from private.notification_delivery_outbox
    where notification_event_key = 'comment:' || (select id from reply_ids where name = 'c_identified')::text
  ),
  'deleting a reply withdraws its pushes that have not gone out'
);
select is(
  (
    select count(*) from private.notification_delivery_outbox
    where notification_id = (select id from pg_temp.reply_notification())
  ),
  4::bigint,
  'pushes for the remaining replies stay queued'
);
select is(
  (select last_activity_at from pg_temp.reply_notification()),
  (select created_at from public.post_comments where id = (select id from reply_ids where name = 'b_anonymous')),
  'deleting the latest reply moves the activity time back to the remaining reply'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select public.delete_post_comment((select id from reply_ids where name = 'b_first'));
reset role;
select ok(
  (
    select comment_id = (select id from reply_ids where name = 'b_anonymous')
      and actor_count = 3
    from pg_temp.reply_notification()
  ),
  'deleting an earlier reply keeps the person counted while their other reply remains'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select public.delete_post_comment((select id from reply_ids where name = 'b_second'));
select public.delete_post_comment((select id from reply_ids where name = 'b_anonymous'));
reset role;
select ok(
  (
    select comment_id = (select id from reply_ids where name = 'c_anonymous')
      and actor_count = 1
    from pg_temp.reply_notification()
  ),
  'deleting every reply by one person removes them from the count'
);

-- 답글 집계 알림은 새 답글마다 보존 기간이 늘어나므로 끝난 Push는 알림과 따로 정리한다.
update private.notification_delivery_outbox
set status = 'sent', completed_at = now() - interval '31 days'
where notification_id = (select id from pg_temp.reply_notification());
select private.cleanup_expired_notifications();
select ok(
  exists (select 1 from pg_temp.reply_notification())
    and not exists (
      select 1 from private.notification_delivery_outbox
      where notification_id = (select id from pg_temp.reply_notification())
    ),
  'finished pushes of a live aggregated notification are pruned after 30 days'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select public.delete_post_comment((select id from reply_ids where name = 'c_anonymous'));
reset role;
select ok(
  not exists (select 1 from pg_temp.reply_notification()),
  'deleting the last reply removes the notification'
);

-- 게시물에 바로 단 댓글은 모으지 않는다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select * from public.create_post_comment(
  '90000000-0000-0000-0000-000000000001', 'B의 댓글', 'identified'
);
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select * from public.create_post_comment(
  '90000000-0000-0000-0000-000000000001', 'C의 댓글', 'identified'
);
reset role;
select is(
  (
    select count(*) from public.notifications
    where kind = 'post_commented'
      and recipient_profile_id = (select id from public.profiles where pub_id = 'kim-admin')
  ),
  3::bigint,
  'comments directly on a post stay separate notifications'
);
select ok(
  (
    select bool_and(actor_count = 1) from public.notifications
    where kind = 'post_commented'
  ),
  'post comment notifications are not aggregated'
);

-- 빈 event key는 unique index가 서로 다르게 보므로 Push 중복을 막지 못한다.
select throws_ok(
  $$select private.enqueue_notification_push(
      (select id from public.notifications where kind = 'post_commented' limit 1), null
    )$$,
  '22023',
  'notification push requires its event key',
  'queueing a push without its event key is rejected'
);

select * from finish();
rollback;
