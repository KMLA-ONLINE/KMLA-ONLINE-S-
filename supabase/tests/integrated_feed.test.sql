begin;

create extension if not exists pgtap with schema extensions;
select plan(33);

select ok(
  has_function_privilege('authenticated', 'public.list_feed_posts(uuid)', 'execute'),
  'authenticated users can list the integrated feed'
);
select ok(
  not has_function_privilege('anon', 'public.list_feed_posts(uuid)', 'execute'),
  'anonymous users cannot list the integrated feed'
);
select ok(
  not has_table_privilege('authenticated', 'private.feed_sessions', 'select')
    and not has_table_privilege(
      'authenticated', 'private.post_reaction_count_events', 'select'
    ),
  'feed sessions and ranking events are not client-readable'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'private.feed_sessions'::regclass)
    and (select relrowsecurity
      from pg_class where oid = 'private.post_reaction_count_events'::regclass),
  'private feed state has defense-in-depth RLS'
);

select is(
  private.feed_rank_time(
    '2026-08-24 11:00:00+00', null, '2026-08-24 12:00:00+00', 1, 1, false
  ),
  '2026-08-24 11:12:00+00'::timestamptz,
  'the immutable rank helper applies four and eight minute activity weights'
);
select is(
  private.feed_rank_time(
    '2026-08-24 06:00:00+00', null, '2026-08-24 12:00:00+00', 20, 20, false
  ),
  '2026-08-24 06:00:00+00'::timestamptz,
  'activity stops affecting rank at six hours'
);
select is(
  private.feed_rank_time(
    '2026-08-24 11:00:00+00', '2026-08-24 11:30:00+00',
    '2026-08-24 12:00:00+00', 20, 20, false
  ),
  '2026-08-24 11:30:00+00'::timestamptz,
  'an effective bump replaces rather than restarts activity ranking'
);
select is(
  private.feed_rank_time(
    '2026-08-24 11:00:00+00', null, '2026-08-24 12:00:00+00', 0, 0, true
  ),
  '2026-08-24 10:00:00+00'::timestamptz,
  'recent cross-timeline posts receive the one hour adjustment'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000071', 'authenticated', 'authenticated',
    'alumni29@kmla.hs.kr', '', now(), '', '', '', '', '', '', '', '', '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000072', 'authenticated', 'authenticated',
    'alumni25@kmla.hs.kr', '', now(), '', '', '', '', '', '', '', '', '{}', '{}', now(), now()
  );

insert into public.profiles (
  auth_user_id, pub_id, name, type, cohort, gender, academic_track, status
)
values
  (
    '10000000-0000-0000-0000-000000000071', 'feed-alumni-29', '29기 졸업생',
    'alumni', 29, 'female', 'domestic', 'accepted'
  ),
  (
    '10000000-0000-0000-0000-000000000072', 'feed-alumni-25', '25기 졸업생',
    'alumni', 25, 'male', 'domestic', 'accepted'
  );

insert into public.group_memberships (group_id, profile_id)
select '20000000-0000-0000-0000-000000000003', profile.id
from public.profiles as profile
where profile.auth_user_id = '10000000-0000-0000-0000-000000000001'
on conflict (group_id, profile_id) do nothing;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select set_post_reaction('90000000-0000-0000-0000-000000000003', 'like');
reset role;
select is(
  (
    select sum(event.delta)::integer
    from private.post_reaction_count_events as event
    where event.post_id = '90000000-0000-0000-0000-000000000003'
  ),
  2,
  'setting a reaction appends one count event alongside the seeded reaction'
);
set local role authenticated;
select clear_post_reaction('90000000-0000-0000-0000-000000000003');
reset role;
select is(
  (
    select sum(event.delta)::integer
    from private.post_reaction_count_events as event
    where event.post_id = '90000000-0000-0000-0000-000000000003'
  ),
  1,
  'clearing a reaction appends a negative count event'
);

select throws_ok(
  $$update private.post_reaction_count_events set delta = -delta where id = (
      select min(id) from private.post_reaction_count_events
    )$$,
  '55000', 'feed ranking events are append-only',
  'reaction count history cannot be rewritten'
);

set local role authenticated;
create temporary table bump_comments (name text primary key, id uuid);
grant select, insert on bump_comments to authenticated;

insert into bump_comments
select 'first', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000003', ' #업 ', 'identified'
);
insert into bump_comments
select 'cooldown', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000003', '#업', 'identified'
);
insert into bump_comments
select 'reply', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000003', '#업', 'identified',
  (select id from bump_comments where name = 'first')
);
insert into bump_comments
select 'edited', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000003', 'ordinary', 'identified'
);
select * from public.update_post_comment(
  (select id from bump_comments where name = 'edited'), '#업'
);
insert into bump_comments
select 'anonymous', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000001', '#업', 'anonymous'
);
reset role;

select is(
  (
    select count(*)
    from private.feed_bump_events as bump
    where bump.post_id = '90000000-0000-0000-0000-000000000003'
  ),
  1::bigint,
  'only the first exact trimmed top-level identified bump in the cooldown is effective'
);
select is(
  (
    select bump.comment_id
    from private.feed_bump_events as bump
    where bump.post_id = '90000000-0000-0000-0000-000000000003'
  ),
  (select id from bump_comments where name = 'first'),
  'the effective bump records its insertion-only source comment'
);
select is(
  (
    select count(*)
    from private.feed_bump_events as bump
    where bump.comment_id = (select id from bump_comments where name = 'edited')
  ),
  0::bigint,
  'editing an ordinary comment into #업 does not create an event'
);
select is(
  (
    select count(*)
    from private.feed_bump_events as bump
    where bump.comment_id = (select id from bump_comments where name = 'anonymous')
  ),
  0::bigint,
  'anonymous #업 comments never create effective bump events'
);

-- Build enough mixed candidates to exercise both diversity limits and opaque paging.
insert into public.posts (
  id, kind, body, group_id, title, author_identity, display_author_profile_id,
  created_at, published_at
)
select
  gen_random_uuid(), 'group', 'official feed body ' || series.n,
  '20000000-0000-0000-0000-000000000001', 'official feed ' || series.n,
  case when series.n = 1 then 'staff'::public.post_identity
    else 'identified'::public.post_identity end,
  case when series.n = 1 then null
    else (select id from public.profiles where pub_id = 'kim-admin') end,
  statement_timestamp() - make_interval(secs => series.n * 10),
  statement_timestamp() - make_interval(secs => series.n * 10)
from generate_series(1, 14) as series(n);

insert into private.post_authors (post_id, profile_id)
select post.id, profile.id
from public.posts as post
cross join public.profiles as profile
where post.title like 'official feed %' and profile.pub_id = 'kim-admin';

insert into public.posts (
  id, kind, body, group_id, title, author_identity, display_author_profile_id,
  created_at, published_at
)
select
  gen_random_uuid(), 'group', 'makers feed body ' || series.n,
  '20000000-0000-0000-0000-000000000003', 'makers feed ' || series.n,
  case when series.n = 1 then 'anonymous'::public.post_identity
    else 'identified'::public.post_identity end,
  case when series.n = 1 then null
    else (select id from public.profiles where pub_id = 'hanbyeol-25') end,
  statement_timestamp() - make_interval(secs => series.n * 10 + 5),
  statement_timestamp() - make_interval(secs => series.n * 10 + 5)
from generate_series(1, 14) as series(n);

insert into private.post_authors (post_id, profile_id)
select post.id, profile.id
from public.posts as post
cross join public.profiles as profile
where post.title like 'makers feed %' and profile.pub_id = 'hanbyeol-25';

insert into public.posts (
  id, kind, body, timeline_profile_id, author_identity, display_author_profile_id,
  visibility, created_at, published_at
)
select
  gen_random_uuid(), 'profile', 'personal feed ' || series.n, profile.id,
  'identified', profile.id, 'public',
  statement_timestamp() - make_interval(secs => series.n * 10 + 2),
  statement_timestamp() - make_interval(secs => series.n * 10 + 2)
from generate_series(1, 6) as series(n)
cross join public.profiles as profile
where profile.pub_id = 'kim-admin';

insert into private.post_authors (post_id, profile_id)
select post.id, profile.id
from public.posts as post
cross join public.profiles as profile
where post.body like 'personal feed %' and profile.pub_id = 'kim-admin';

insert into public.posts (
  id, kind, body, timeline_profile_id, author_identity, display_author_profile_id,
  visibility, created_at, published_at
)
select
  gen_random_uuid(), 'profile', 'cross timeline candidate', timeline.id,
  'identified', author_profile.id, 'public',
  statement_timestamp() - interval '2 minutes',
  statement_timestamp() - interval '2 minutes'
from public.profiles as timeline
cross join public.profiles as author_profile
where timeline.auth_user_id = '10000000-0000-0000-0000-000000000001'
  and author_profile.pub_id = 'hanbyeol-25';

insert into private.post_authors (post_id, profile_id)
select post.id, profile.id
from public.posts as post
cross join public.profiles as profile
where post.body = 'cross timeline candidate' and profile.pub_id = 'hanbyeol-25';

insert into public.post_attachments (
  id, post_id, object_path, original_filename, position, mime_type, size_bytes,
  width, height, status, ready_at
)
select attachment.id, post.id, post.id::text || '/' || attachment.id::text, 'feed.webp', 0,
  'image/webp', 2048, 320, 180, 'ready', statement_timestamp()
from public.posts as post
cross join lateral (select gen_random_uuid() as id) as attachment
where post.title = 'official feed 1';

select ok(
  private.can_access_feed_post(
    (select id from public.posts where body = 'cross timeline candidate'),
    (select id from public.profiles
      where auth_user_id = '10000000-0000-0000-0000-000000000001')
  ),
  'a student sees a cross-timeline post for an overlapping cohort'
);
select ok(
  private.can_access_feed_post(
    (select id from public.posts where body = 'cross timeline candidate'),
    (select id from public.profiles where pub_id = 'feed-alumni-29')
  ),
  'an alumnus sees 생탐 when their cohort overlaps an accepted student cohort'
);
select ok(
  not private.can_access_feed_post(
    (select id from public.posts where body = 'cross timeline candidate'),
    (select id from public.profiles where pub_id = 'feed-alumni-25')
  ),
  'an alumnus without a currently accepted student cohort does not see 생탐'
);

set local role anon;
select throws_ok(
  $$select * from public.list_feed_posts()$$,
  '42501', null, 'anonymous callers cannot create feed sessions'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
create temporary table first_feed_page as
select * from public.list_feed_posts();
reset role;

select is((select count(*) from first_feed_page), 20::bigint, 'feed pages contain 20 posts');
select is(
  (select count(distinct feed_epoch) from first_feed_page),
  1::bigint,
  'every row carries the exact stable server feed epoch'
);
select isnt(
  (select next_page_token from first_feed_page limit 1),
  null::uuid,
  'the next page is represented by an opaque server token'
);
select ok(
  (select count(*) <= 10 from first_feed_page
    where group_id = '20000000-0000-0000-0000-000000000001')
    and (select count(*) <= 10 from first_feed_page
      where group_id = '20000000-0000-0000-0000-000000000003'),
  'each group contributes at most ten posts while alternatives can fill the page'
);
select ok(
  (select count(*) <= 4 from first_feed_page
    where kind = 'profile' and author_pub_id = 'kim-admin'),
  'one personal author contributes at most four posts per page'
);
select ok(
  not exists (
    select 1
    from (
      select group_id,
        lag(group_id, 1) over (order by feed_position) as previous_one,
        lag(group_id, 2) over (order by feed_position) as previous_two,
        lag(group_id, 3) over (order by feed_position) as previous_three
      from first_feed_page
    ) as ordered
    where group_id is not null
      and group_id = previous_one and group_id = previous_two and group_id = previous_three
  ),
  'a group never occupies four consecutive slots while alternatives exist'
);
select ok(
  exists (
    select 1 from first_feed_page
    where author_identity = 'anonymous'
      and author_pub_id is null and author_name is null and author_avatar_path is null
  ),
  'anonymous post authors remain hidden in feed output'
);
select ok(
  exists (
    select 1 from first_feed_page
    where author_identity = 'staff' and author_pub_id = 'kim-admin'
      and author_name = '김관리' and author_label = '운영진'
  ),
  'staff posts expose the canonical author profile while retaining the staff label'
);
select ok(
  exists (
    select 1 from first_feed_page
    where attachments @> '[{"original_filename":"feed.webp","size_bytes":2048}]'::jsonb
  ),
  'feed output includes ordered attachment metadata'
);

insert into public.posts (
  id, kind, body, group_id, title, author_identity, display_author_profile_id,
  created_at, published_at
)
select gen_random_uuid(), 'group', 'created after feed epoch',
  '20000000-0000-0000-0000-000000000001', 'after session', 'identified', profile.id,
  statement_timestamp(), statement_timestamp()
from public.profiles as profile where profile.pub_id = 'kim-admin';
insert into private.post_authors (post_id, profile_id)
select post.id, profile.id
from public.posts as post
cross join public.profiles as profile
where post.title = 'after session' and profile.pub_id = 'kim-admin';

set local role authenticated;
create temporary table second_feed_page as
select * from public.list_feed_posts(
  (select next_page_token from first_feed_page limit 1)
);
reset role;

select is(
  (select count(*) from second_feed_page where title = 'after session'),
  0::bigint,
  'posts published after the epoch never enter later pages of the session'
);
select is(
  (select count(distinct feed_epoch) from second_feed_page),
  1::bigint,
  'later pages retain one epoch'
);
select is(
  (select min(feed_epoch) from second_feed_page),
  (select min(feed_epoch) from first_feed_page),
  'later pages retain the exact first-page epoch'
);

delete from public.group_memberships
where group_id = '20000000-0000-0000-0000-000000000003'
  and profile_id = (
    select id from public.profiles
    where auth_user_id = '10000000-0000-0000-0000-000000000001'
  );

select ok(
  not exists (
    select 1
    from private.feed_session_posts as session_post
    join public.posts as post on post.id = session_post.post_id
    where session_post.session_id = (
      select page.session_id from private.feed_pages as page
      where page.token = (select next_page_token from first_feed_page limit 1)
    )
      and post.group_id = '20000000-0000-0000-0000-000000000003'
      and private.can_access_feed_post(
        post.id,
        (select id from public.profiles
          where auth_user_id = '10000000-0000-0000-0000-000000000001')
      )
  ),
  'delivery access checks immediately remove posts from a group the viewer left'
);

select ok(
  to_regclass('public.feed_read_states') is null
    and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles'
        and column_name in ('last_feed_seen_at', 'feed_seen_at')
    ),
  'the integrated feed adds no server-side read or new-post state'
);

select * from finish();
rollback;
