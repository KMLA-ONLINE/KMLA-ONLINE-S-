begin;

create extension if not exists pgtap with schema extensions;
select plan(13);

select set_config(
  'test.me',
  (select id::text from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001'),
  true
);
select set_config(
  'test.other',
  (select id::text from public.profiles where pub_id = 'hanbyeol-25'),
  true
);

-- The caller's group 2 watermark sits an hour back, so another member's post from 30 minutes ago is new.
update public.group_memberships
set posts_visited_at = statement_timestamp() - interval '1 hour'
where group_id = '20000000-0000-0000-0000-000000000002'
  and profile_id = current_setting('test.me')::bigint;

insert into public.posts (
  id, kind, body, group_id, title, author_identity, created_at, published_at
)
values
  (
    '97000000-0000-0000-0000-000000000001', 'group', '다른 멤버의 새 글',
    '20000000-0000-0000-0000-000000000002', '새 글', 'anonymous',
    statement_timestamp() - interval '30 minutes', statement_timestamp() - interval '30 minutes'
  ),
  (
    '97000000-0000-0000-0000-000000000002', 'group', '알림이 따로 있는 글',
    '20000000-0000-0000-0000-000000000002', '다른 글', 'anonymous',
    statement_timestamp() - interval '20 minutes', statement_timestamp() - interval '20 minutes'
  );
insert into private.post_authors (post_id, profile_id)
values
  ('97000000-0000-0000-0000-000000000001', current_setting('test.other')::bigint),
  ('97000000-0000-0000-0000-000000000002', current_setting('test.other')::bigint);

insert into public.posts (
  id, kind, body, timeline_profile_id, author_identity, display_author_profile_id, visibility,
  created_at, published_at
)
values (
  '97000000-0000-0000-0000-000000000003', 'profile', '내 타임라인 글',
  current_setting('test.me')::bigint, 'identified', current_setting('test.me')::bigint,
  'public', statement_timestamp() - interval '1 day', statement_timestamp() - interval '1 day'
);

insert into public.notifications (
  id, recipient_profile_id, kind, importance, category, actor_identity,
  actor_profile_id, actor_display_name, group_id, post_id, title, created_at, last_activity_at, read_at
)
values
  -- The caller's two unread notifications on the new group post and one already read.
  (
    '71000000-0000-0000-0000-000000000001', current_setting('test.me')::bigint,
    'group_posted', 'normal', 'content', 'anonymous', null, '익명',
    '20000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001',
    '새 글 알림', now() - interval '30 minutes', now() - interval '30 minutes', null
  ),
  (
    '71000000-0000-0000-0000-000000000002', current_setting('test.me')::bigint,
    'post_mentioned', 'normal', 'content', 'anonymous', null, '익명',
    '20000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001',
    '멘션 알림', now() - interval '25 minutes', now() - interval '25 minutes', null
  ),
  (
    '71000000-0000-0000-0000-000000000003', current_setting('test.me')::bigint,
    'post_reacted', 'low', 'content', 'anonymous', null, '익명',
    '20000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001',
    '이미 읽은 알림', now() - interval '25 minutes', now() - interval '25 minutes',
    now() - interval '10 minutes'
  ),
  -- Another member's notification on the same post.
  (
    '71000000-0000-0000-0000-000000000004', current_setting('test.other')::bigint,
    'post_commented', 'normal', 'content', 'anonymous', null, '익명',
    '20000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001',
    '남의 알림', now() - interval '25 minutes', now() - interval '25 minutes', null
  ),
  -- The caller's notification on a different post.
  (
    '71000000-0000-0000-0000-000000000005', current_setting('test.me')::bigint,
    'group_posted', 'normal', 'content', 'anonymous', null, '익명',
    '20000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000002',
    '다른 글 알림', now() - interval '20 minutes', now() - interval '20 minutes', null
  ),
  -- A comment on the caller's own timeline post.
  (
    '71000000-0000-0000-0000-000000000006', current_setting('test.me')::bigint,
    'post_commented', 'normal', 'content', 'identified', current_setting('test.other')::bigint, '한별',
    null, '97000000-0000-0000-0000-000000000003',
    '타임라인 댓글 알림', now() - interval '5 minutes', now() - interval '5 minutes', null
  );

select ok(
  has_function_privilege('authenticated', 'public.mark_post_opened(uuid)', 'EXECUTE'),
  'authenticated can record opening a post'
);
select ok(
  not has_function_privilege('anon', 'public.mark_post_opened(uuid)', 'EXECUTE'),
  'anonymous visitors cannot record opening a post'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is(
  (select row(counted_as_new, notifications_read)::text
   from public.mark_post_opened('97000000-0000-0000-0000-000000000001')),
  row(true, 2)::text,
  'opening a new group post drops its count and reads its two unread notifications'
);
select is(
  (
    select new_post_count
    from public.get_my_group_new_post_counts()
    where group_id = '20000000-0000-0000-0000-000000000002'
  ),
  1::bigint,
  'the opened post leaves the group new-post count'
);
select is(
  (
    select count(*)
    from public.notifications
    where post_id = '97000000-0000-0000-0000-000000000001'
      and recipient_profile_id = current_setting('test.me')::bigint
      and read_at is null
  ),
  0::bigint,
  'no unread notification on the opened post is left'
);
select is(
  (select read_at from public.notifications where id = '71000000-0000-0000-0000-000000000003'),
  now() - interval '10 minutes',
  'an already read notification keeps its read time'
);
select is(
  (select read_at from public.notifications where id = '71000000-0000-0000-0000-000000000005'),
  null,
  'a notification on another post stays unread'
);

-- Aggregation brings a notification back as unread while the post is open; the next open reads it.
reset role;
update public.notifications
set read_at = null, last_activity_at = now()
where id = '71000000-0000-0000-0000-000000000002';
set local role authenticated;

select is(
  (select row(counted_as_new, notifications_read)::text
   from public.mark_post_opened('97000000-0000-0000-0000-000000000001')),
  row(false, 1)::text,
  'opening the post again reads the notification that came back but leaves the count alone'
);

select is(
  (select row(counted_as_new, notifications_read)::text
   from public.mark_post_opened('97000000-0000-0000-0000-000000000003')),
  row(false, 1)::text,
  'opening a timeline post reads its notification without a new-post count'
);

select is(
  (select row(counted_as_new, notifications_read)::text
   from public.mark_post_opened('97000000-0000-0000-0000-000000000099')),
  row(false, 0)::text,
  'a missing post changes nothing'
);

select is(
  public.mark_post_read('97000000-0000-0000-0000-000000000002'),
  true,
  'the old read call still drops the count for clients that predate opening'
);

reset role;
select is(
  (select read_at from public.notifications where id = '71000000-0000-0000-0000-000000000004'),
  null,
  'another member''s notification on the opened post stays unread'
);
select is(
  (select read_at from public.notifications where id = '71000000-0000-0000-0000-000000000005'),
  null,
  'the old read call does not read notifications'
);

select * from finish();
rollback;
