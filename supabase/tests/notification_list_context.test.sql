begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

-- 알림함 목록이 댓글 본문과 반응 종류를 읽을 때 붙이는지(기능 명세 §14.3). 게시물
-- 90000000-...-0001의 작성자는 kim-admin이다.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000', user_id, 'authenticated',
  'authenticated', email, '', now(), '{}', '{}', now(), now()
from (values
  ('10000000-0000-0000-0000-000000000002'::uuid, 'context-admin@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000003'::uuid, 'context-a@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000004'::uuid, 'context-b@kmla.hs.kr')
) as users(user_id, email);

update public.profiles
set auth_user_id = case pub_id
  when 'kim-admin' then '10000000-0000-0000-0000-000000000002'::uuid
  when 'hanbyeol-25' then '10000000-0000-0000-0000-000000000003'::uuid
  when 'saebyeok-24' then '10000000-0000-0000-0000-000000000004'::uuid
end
where pub_id in ('kim-admin', 'hanbyeol-25', 'saebyeok-24');

delete from public.notifications;
delete from private.notification_event_keys;
-- 시드의 기존 반응이 남아 있으면 반응 변경(UPDATE)이 되어 알림이 생기지 않는다.
delete from public.post_reactions
where post_id = '90000000-0000-0000-0000-000000000001'
  and profile_id = (select id from public.profiles where pub_id = 'saebyeok-24');

create temp table context_ids (name text primary key, id uuid);
grant select, insert on context_ids to authenticated;

-- hanbyeol이 kim-admin의 게시물에 댓글을, saebyeok이 그 댓글에 답글을 단다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
insert into context_ids
select 'comment', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000001', '  첫 댓글 본문  ', 'identified'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
insert into context_ids
select 'reply', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000001', '답글 본문', 'identified',
  (select id from context_ids where name = 'comment')
);
select * from public.set_post_reaction('90000000-0000-0000-0000-000000000001', 'haha');
select * from public.set_comment_reaction((select id from context_ids where name = 'comment'), 'wow');
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is(
  (select comment_excerpt from public.list_my_notifications(null, null, 20) where kind = 'post_commented'),
  '첫 댓글 본문',
  'a comment notification carries the trimmed comment body'
);
select is(
  (select reaction from public.list_my_notifications(null, null, 20) where kind = 'post_reacted'),
  'haha'::public.post_reaction,
  'a post reaction notification carries the reaction kind'
);
select ok(
  (select bool_and(case kind
      when 'post_commented' then reaction is null
      when 'post_reacted' then comment_excerpt is null
    end)
   from public.list_my_notifications(null, null, 20)),
  'context columns stay empty where they do not apply'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select public.update_post_comment(
  (select id from context_ids where name = 'comment'), '고친 댓글 본문'
);
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select * from public.set_post_reaction('90000000-0000-0000-0000-000000000001', 'sad');
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is(
  (select comment_excerpt from public.list_my_notifications(null, null, 20) where kind = 'post_commented'),
  '고친 댓글 본문',
  'the excerpt follows a later edit instead of a stored snapshot'
);
select is(
  (select reaction from public.list_my_notifications(null, null, 20) where kind = 'post_reacted'),
  'sad'::public.post_reaction,
  'the reaction kind follows the actor''s current reaction'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select * from public.clear_post_reaction('90000000-0000-0000-0000-000000000001');
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select ok(
  (select reaction is null from public.list_my_notifications(null, null, 20) where kind = 'post_reacted'),
  'a removed reaction leaves the kind empty while the notification remains'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select is(
  (select comment_excerpt from public.list_my_notifications(null, null, 20) where kind = 'comment_replied'),
  '답글 본문',
  'a reply notification carries the reply body'
);
select is(
  (select reaction from public.list_my_notifications(null, null, 20) where kind = 'comment_reacted'),
  'wow'::public.post_reaction,
  'a comment reaction notification carries the reaction kind'
);
reset role;

-- 그룹을 나간 수신자에게는 그 그룹 댓글 본문을 보여주지 않는다.
delete from public.group_memberships
where group_id = '20000000-0000-0000-0000-000000000003'
  and profile_id = (select id from public.profiles where pub_id = 'hanbyeol-25');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select is(
  (select count(*) from public.list_my_notifications(null, null, 20) where kind = 'comment_replied'),
  1::bigint,
  'the reply notification itself survives leaving the group'
);
select ok(
  (select comment_excerpt is null from public.list_my_notifications(null, null, 20) where kind = 'comment_replied'),
  'a recipient who can no longer read the post gets no comment body'
);
reset role;

select * from finish();
rollback;
