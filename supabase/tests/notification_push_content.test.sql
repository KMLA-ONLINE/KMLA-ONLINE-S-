begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

create temp table fixture as
select
  (select id from public.profiles where pub_id = 'hanbyeol-25') as recipient_id,
  (select id from public.profiles where pub_id = 'saebyeok-24') as actor_id,
  target_group.id as group_id,
  target_group.name as group_name,
  target_post.id as post_id,
  target_post.title as post_title
from public.groups as target_group
join public.posts as target_post on target_post.group_id = target_group.id
where target_group.id = '20000000-0000-0000-0000-000000000003'
  and target_post.id = '90000000-0000-0000-0000-000000000001';

create temp table emitted (label text primary key, notification_id uuid);

insert into emitted
select 'comment', private.emit_notification(
  'push-content:comment', fixture.recipient_id,
  'post_commented', 'normal', 'content', 'identified',
  fixture.actor_id, '박새벽', null, '내 게시물에 새 댓글이 등록되었습니다.',
  fixture.group_id, fixture.post_id
) from fixture;
insert into emitted
select 'group-post', private.emit_notification(
  'push-content:group-post', fixture.recipient_id,
  'group_posted', 'low', 'group', 'anonymous',
  null, '익명', null, fixture.post_title,
  fixture.group_id, fixture.post_id
) from fixture;
insert into emitted
select 'join-request', private.emit_notification(
  'push-content:join-request', fixture.recipient_id,
  'group_join_requested', 'normal', 'group', 'identified',
  fixture.actor_id, '박새벽', null, '새 그룹 가입 요청이 있습니다.',
  fixture.group_id
) from fixture;
insert into emitted
select 'moderated', private.emit_notification(
  'push-content:moderated', fixture.recipient_id,
  'post_moderated', 'high', 'moderation', 'staff',
  fixture.actor_id, '운영진', null, '“점심 메뉴” 게시물을 운영진이 삭제했습니다.',
  fixture.group_id
) from fixture;
insert into emitted
select 'approved', private.emit_notification(
  'push-content:approved', fixture.recipient_id,
  'account_approved', 'high', 'account', 'staff',
  fixture.actor_id, '운영진', null, '가입이 승인되었습니다.'
) from fixture;

create temp table content as
select emitted.label, push.title, push.body
from emitted
cross join lateral private.notification_push_content(emitted.notification_id) as push;

select results_eq(
  $$select title, body from content where label = 'comment'$$,
  $$select '박새벽 · ' || group_name,
      '“' || case when char_length(post_title) > 40 then left(post_title, 39) || '…' else post_title end
        || '”에 댓글을 남겼습니다.'
    from fixture$$,
  'a comment card names the commenter, the group and the post, not the comment'
);
select results_eq(
  $$select title, body from content where label = 'group-post'$$,
  $$select group_name, '익명: ' || post_title from fixture$$,
  'a new group post card names the group, then the author and post title'
);
select results_eq(
  $$select title, body from content where label = 'join-request'$$,
  $$select group_name, '박새벽님이 가입을 요청했습니다.' from fixture$$,
  'a join request card names the group and the requester'
);
select results_eq(
  $$select title, body from content where label = 'moderated'$$,
  $$values ('운영 조치', '“점심 메뉴” 게시물을 운영진이 삭제했습니다.')$$,
  'a moderation card keeps the moderator anonymous'
);
select results_eq(
  $$select title, body from content where label = 'approved'$$,
  $$values ('KMLA Online', '가입이 승인되었습니다. 이제 KMLA Online을 이용할 수 있습니다.')$$,
  'an account card does not repeat its title as the body'
);

update public.notifications
set actor_count = 3
where id = (select notification_id from emitted where label = 'comment');
select is(
  (select push.title
   from emitted
   cross join lateral private.notification_push_content(emitted.notification_id) as push
   where emitted.label = 'comment'),
  (select '박새벽 외 2명 · ' || group_name from fixture),
  'an aggregated card counts the other actors'
);

select ok(
  not exists (
    select 1 from emitted
    cross join lateral private.notification_push_content(emitted.notification_id) as push
    where push.body = '새 알림이 있습니다.' or push.title = push.body
  ),
  'no card falls back to a placeholder or repeats its title'
);

select ok(
  not has_function_privilege('authenticated', 'private.notification_push_content(uuid)', 'execute'),
  'browser roles cannot render push content'
);

select * from finish();
rollback;
