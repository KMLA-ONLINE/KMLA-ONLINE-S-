begin;

create extension if not exists pgtap with schema extensions;
select plan(45);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000', user_id, 'authenticated',
  'authenticated', email, '', now(), '{}', '{}', now(), now()
from (values
  ('10000000-0000-0000-0000-000000000002'::uuid, 'restriction-owner@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000003'::uuid, 'restriction-target@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000004'::uuid, 'restriction-member@kmla.hs.kr')
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
insert into private.web_push_subscriptions (
  profile_id, endpoint, p256dh, auth, created_at
) values (
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'https://push.example.test/anonymous-restriction',
  'BNcRdreALRFXTkA0bP8M5bq6fP6w6uLqFhKxqv2QdA',
  'dGVzdC1hdXRoLWtleQ', now() - interval '1 hour'
);

create temp table restriction_ids (name text primary key, id uuid);
grant select, insert on restriction_ids to authenticated;

select ok(
  (select relrowsecurity from pg_class
   where oid = 'private.group_anonymous_activity_restrictions'::regclass),
  'the restriction history has RLS enabled'
);
select is(
  (select count(*)::integer
   from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as verb(privilege)
   where has_table_privilege(
     'authenticated', 'private.group_anonymous_activity_restrictions', verb.privilege
   )),
  0,
  'clients cannot access restriction history directly'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.restrict_group_anonymous_activity(text,uuid,text,integer)', 'EXECUTE'
  ) and not has_function_privilege(
    'anon', 'public.restrict_group_anonymous_activity(text,uuid,text,integer)', 'EXECUTE'
  ),
  'only authenticated clients can call the restriction RPC'
);
select ok(
  position('profile_id' in pg_get_function_result(
    'public.restrict_group_anonymous_activity(text,uuid,text,integer)'::regprocedure
  )) = 0,
  'the restriction result discloses no target profile id'
);

-- Create both unpublished paths and another anonymous source before restricting the target.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
insert into restriction_ids values (
  'commit_draft', public.create_group_post(
    '20000000-0000-0000-0000-000000000003', '커밋 초안', '본문', 'anonymous', null, false
  )
);
insert into restriction_ids values (
  'publish_draft', public.create_group_post(
    '20000000-0000-0000-0000-000000000003', '게시 초안', '본문', 'anonymous', null, false
  )
);
insert into restriction_ids
select 'target_comment', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000002', '다른 해제 출처', 'anonymous'
);
reset role;

-- A plain member cannot moderate, and sources must be live anonymous group content.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select throws_ok(
  $$select * from public.restrict_group_anonymous_activity(
      'post', '90000000-0000-0000-0000-000000000002', '충분히 구체적인 사유', 7
    )$$,
  '42501', 'group anonymous moderation is not allowed',
  'ordinary members cannot restrict anonymous activity'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$select * from public.restrict_group_anonymous_activity(
      'post', '90000000-0000-0000-0000-000000000001', '충분히 구체적인 사유', 7
    )$$,
  'P0002', 'anonymous moderation source not found',
  'identified posts cannot resolve a restriction target'
);
reset role;
update public.posts set deleted_at = now()
where id = '90000000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok(
  $$select * from public.restrict_group_anonymous_activity(
      'comment', (select id from restriction_ids where name = 'target_comment'),
      '충분히 구체적인 사유', 7
    )$$,
  'P0002', 'anonymous moderation source not found',
  'an anonymous comment on a deleted parent post is not a live source'
);
reset role;
update public.posts set deleted_at = null
where id = '90000000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok(
  $$select * from public.restrict_group_anonymous_activity(
      'post', '90000000-0000-0000-0000-000000000002', '짧음', 7
    )$$,
  '22023', 'reason must contain between 5 and 300 characters',
  'restriction reasons are trimmed and length checked'
);
select throws_ok(
  $$select * from public.restrict_group_anonymous_activity(
      'post', '90000000-0000-0000-0000-000000000002', '충분히 구체적인 사유', 181
    )$$,
  '22023', 'duration days must be an integer between 1 and 180',
  'restriction duration is capped at 180 days'
);

insert into restriction_ids
select 'self_source', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000002', '운영자 자신의 익명 댓글', 'anonymous'
);
select throws_ok(
  $$select * from public.restrict_group_anonymous_activity(
      'comment', (select id from restriction_ids where name = 'self_source'),
      '자기 자신을 제한할 수 없음', 7
    )$$,
  '42501', 'cannot moderate own anonymous activity',
  'moderators cannot act on their own anonymous source'
);

select lives_ok(
  $$select * from public.restrict_group_anonymous_activity(
      'post', '90000000-0000-0000-0000-000000000002',
      '  반복적인 익명 규칙 위반  ', 7
    )$$,
  'an owner can restrict through a live anonymous post'
);
reset role;
select is(
  (select reason from private.group_anonymous_activity_restrictions where ended_at is null),
  '반복적인 익명 규칙 위반',
  'the database stores the trimmed reason'
);
select ok(
  (select expires_at between now() + interval '6 days 23 hours'
    and now() + interval '7 days 1 minute'
   from private.group_anonymous_activity_restrictions where ended_at is null),
  'the database computes expiry from duration days'
);
set local role authenticated;
select throws_ok(
  $$select * from public.restrict_group_anonymous_activity(
      'comment', (select id from restriction_ids where name = 'target_comment'),
      '다른 사유로 기간 연장 시도', 30
    )$$,
  '55000', 'anonymous activity restriction already active',
  'a duplicate active restriction fails without changing it'
);
reset role;
select is(
  (select count(*) from public.notifications where kind = 'anonymous_activity_restricted'),
  1::bigint,
  'a duplicate active restriction emits no second notification'
);
select is(
  (select title from public.notifications where kind = 'anonymous_activity_restricted'),
  '그룹 익명 활동이 제한되었습니다.',
  'the moderation notification title is generic'
);
select is(
  (select detail from public.notifications where kind = 'anonymous_activity_restricted'),
  '반복적인 익명 규칙 위반',
  'the in-app notification carries the reason as detail'
);
select ok(
  (select restriction_expires_at = restriction.expires_at
   from public.notifications as notification
   join private.group_anonymous_activity_restrictions as restriction
     on restriction.profile_id = notification.recipient_profile_id
   where notification.kind = 'anonymous_activity_restricted'),
  'the in-app notification carries the canonical expiry'
);
select set_config(
  'test.restriction_expires_at',
  (select expires_at::text
   from private.group_anonymous_activity_restrictions
   where ended_at is null),
  true
);

set local role authenticated;
select ok(
  (select can_moderate_anonymous and anonymous_author_restricted
     and anonymous_author_restriction_expires_at
       = current_setting('test.restriction_expires_at')::timestamptz
   from public.get_group_post('90000000-0000-0000-0000-000000000002')),
  'post detail exposes the active restriction expiry without an identity'
);
select ok(
  (select anonymous_author_restriction_expires_at
     = current_setting('test.restriction_expires_at')::timestamptz
   from public.list_group_posts('20000000-0000-0000-0000-000000000003')
   where post_id = '90000000-0000-0000-0000-000000000002'),
  'post lists expose the same active restriction expiry'
);
select ok(
  (select can_moderate_anonymous and anonymous_author_restricted
     and anonymous_author_restriction_expires_at
       = current_setting('test.restriction_expires_at')::timestamptz
   from public.list_post_comment_replies('a0000000-0000-0000-0000-000000000001')
   where comment_id = 'a0000000-0000-0000-0000-000000000002'),
  'shared reply rows expose the same active restriction expiry'
);
select ok(
  (select anonymous_author_restriction_expires_at
     = current_setting('test.restriction_expires_at')::timestamptz
   from public.list_post_comments('90000000-0000-0000-0000-000000000002')
   where comment_id = (select id from restriction_ids where name = 'target_comment')),
  'top-level comment rows expose the same active restriction expiry'
);
reset role;

-- All anonymous publication paths and comments are blocked; identified/staff/reactions remain available.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select is(
  (select reason from public.get_my_group_anonymous_activity_restriction(
    '20000000-0000-0000-0000-000000000003'
  )),
  '반복적인 익명 규칙 위반',
  'the target can read only their own active reason and expiry'
);
select is(
  (select anonymous_author_restriction_expires_at
   from public.get_group_post('90000000-0000-0000-0000-000000000002')),
  null::timestamptz,
  'the anonymous author cannot read a moderator-only restriction expiry'
);
select is(
  (select detail from public.list_my_notifications(null, null, 20)
   where kind = 'anonymous_activity_restricted'),
  '반복적인 익명 규칙 위반',
  'the notification list RPC returns the in-app restriction detail'
);
select throws_ok(
  $$select public.create_group_post(
      '20000000-0000-0000-0000-000000000003', '제한 중 익명 글', '본문', 'anonymous'
    )$$,
  '42501', 'anonymous activity is restricted',
  'immediate anonymous post creation is blocked'
);
select throws_ok(
  $$select public.create_group_post(
      '20000000-0000-0000-0000-000000000003', '제한 중 익명 초안', '본문', 'anonymous', null, false
    )$$,
  '42501', 'anonymous activity is restricted',
  'anonymous draft creation is blocked'
);
select throws_ok(
  $$select public.commit_group_post(
      (select id from restriction_ids where name = 'commit_draft'),
      '커밋 초안', '본문', '{}', true, null
    )$$,
  '42501', 'anonymous activity is restricted',
  'commit-and-publish rechecks the active restriction'
);
select throws_ok(
  $$select public.publish_group_post(
      (select id from restriction_ids where name = 'publish_draft')
    )$$,
  '42501', 'anonymous activity is restricted',
  'standalone publishing rechecks the active restriction'
);
select throws_ok(
  $$select * from public.create_post_comment(
      '90000000-0000-0000-0000-000000000002', '제한 중 익명 댓글', 'anonymous'
    )$$,
  '42501', 'anonymous activity is restricted',
  'anonymous comments are blocked'
);
select lives_ok(
  $$select public.create_group_post(
      '20000000-0000-0000-0000-000000000003', '제한 중 실명 글', '본문', 'identified'
    )$$,
  'identified posts remain allowed'
);
select lives_ok(
  $$select * from public.create_post_comment(
      '90000000-0000-0000-0000-000000000002', '제한 중 실명 댓글', 'identified'
    )$$,
  'identified comments remain allowed'
);
select lives_ok(
  $$select * from public.set_post_reaction(
      '90000000-0000-0000-0000-000000000002', 'like'
    )$$,
  'reactions remain allowed'
);
reset role;
update public.group_memberships set role = 'manager'
where group_id = '20000000-0000-0000-0000-000000000003'
  and profile_id = (select id from public.profiles where pub_id = 'hanbyeol-25');
set local role authenticated;
select lives_ok(
  $$select * from public.create_post_comment(
      '90000000-0000-0000-0000-000000000002', '제한 중 운영진 댓글', 'staff'
    )$$,
  'staff identity remains allowed for eligible restricted members'
);
reset role;

-- Membership churn does not remove the separate restriction history.
delete from public.group_memberships
where group_id = '20000000-0000-0000-0000-000000000003'
  and profile_id = (select id from public.profiles where pub_id = 'hanbyeol-25');
set local role authenticated;
select is(
  (select count(*) from public.get_my_group_anonymous_activity_restriction(
    '20000000-0000-0000-0000-000000000003'
  )),
  1::bigint,
  'leaving does not remove the caller restriction'
);
reset role;
insert into public.group_memberships (group_id, profile_id, role)
values (
  '20000000-0000-0000-0000-000000000003',
  (select id from public.profiles where pub_id = 'hanbyeol-25'), 'member'
);
set local role authenticated;
select throws_ok(
  $$select * from public.create_post_comment(
      '90000000-0000-0000-0000-000000000002', '재가입 뒤 익명 댓글', 'anonymous'
    )$$,
  '42501', 'anonymous activity is restricted',
  'rejoining does not clear the restriction'
);
reset role;

-- Any live anonymous source by the same target can cancel; cancellation is silent and stable.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select lives_ok(
  $$select public.cancel_group_anonymous_activity_restriction(
      'comment', (select id from restriction_ids where name = 'target_comment')
    )$$,
  'another anonymous source by the target can cancel the restriction'
);
select throws_ok(
  $$select public.cancel_group_anonymous_activity_restriction(
      'post', '90000000-0000-0000-0000-000000000002'
    )$$,
  '55000', 'anonymous activity restriction already cancelled',
  'already-cancelled restrictions fail stably'
);
reset role;
select is(
  (select count(*) from public.notifications where kind = 'anonymous_activity_restricted'),
  1::bigint,
  'cancellation emits no notification'
);

update private.group_anonymous_activity_restrictions
set reason = '이미 만료된 제한 사유', created_at = now() - interval '3 days',
  expires_at = now() - interval '1 day', ended_at = null,
  cancelled_at = null, cancelled_by_profile_id = null,
  source_kind = 'comment', source_post_id = null,
  source_comment_id = (select id from restriction_ids where name = 'target_comment')
where reason = '반복적인 익명 규칙 위반';
set local role authenticated;
select throws_ok(
  $$select public.cancel_group_anonymous_activity_restriction(
      'post', '90000000-0000-0000-0000-000000000002'
    )$$,
  '55000', 'anonymous activity restriction is expired',
  'expired restrictions fail cancellation stably'
);
select lives_ok(
  $$select * from public.restrict_group_anonymous_activity(
      'comment', (select id from restriction_ids where name = 'target_comment'),
      '만료 뒤 새로 적용한 사유', 3
    )$$,
  'a new restriction closes expired history before insertion'
);
reset role;
select is(
  (select count(*) from private.group_anonymous_activity_restrictions
   where ended_at is null),
  1::bigint,
  'only one current restriction remains after replacing expired history'
);

set local role service_role;
create temp table restriction_delivery as
select * from public.claim_notification_deliveries(20, 60)
where title = '그룹 익명 활동이 제한되었습니다.';
select is(
  (select min(title) from restriction_delivery),
  '그룹 익명 활동이 제한되었습니다.',
  'Web Push receives only the generic restriction title'
);
select ok(
  (select bool_and(body not like '%만료 뒤 새로 적용한 사유%') from restriction_delivery),
  'Web Push excludes the restriction reason'
);
reset role;

delete from public.post_comments where id = (select id from restriction_ids where name = 'target_comment');
select ok(
  exists (
    select 1 from private.group_anonymous_activity_restrictions
    where reason = '만료 뒤 새로 적용한 사유' and source_comment_id is null
  ),
  'source deletion nulls the reference without removing restriction history'
);

select * from finish();
rollback;
