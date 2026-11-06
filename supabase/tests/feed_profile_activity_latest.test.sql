begin;

create extension if not exists pgtap with schema extensions;
select plan(3);

-- 같은 사람이 프로필 사진을 여러 번 바꾸면 피드에는 종류마다 가장 최근 활동 하나만 들어간다(기능 명세 §6.1).
-- 본인 활동은 본인 피드에 언제나 들어오므로 홍길동 자신을 보는 사람으로 쓴다.
create temporary table activity_posts (name text primary key, id uuid not null);

with spec (name, activity_kind, age) as (
  values
    ('old-avatar', 'avatar_changed'::public.profile_media_activity_kind, interval '30 minutes'),
    ('new-avatar', 'avatar_changed'::public.profile_media_activity_kind, interval '10 minutes'),
    ('only-cover', 'cover_changed'::public.profile_media_activity_kind, interval '20 minutes')
), created as (
  insert into public.posts (
    id, kind, body, timeline_profile_id, author_identity, display_author_profile_id,
    visibility, created_at, published_at, activity_kind, activity_media_path
  )
  select
    gen_random_uuid(), 'profile', '', profile.id, 'identified', profile.id,
    'public', statement_timestamp() - spec.age, statement_timestamp() - spec.age,
    spec.activity_kind,
    profile.auth_user_id::text || '/' || case spec.activity_kind
      when 'avatar_changed' then 'avatar' else 'cover' end || '/' || gen_random_uuid()
  from spec
  cross join public.profiles as profile
  where profile.auth_user_id = '10000000-0000-0000-0000-000000000001'
  returning id, published_at
)
insert into activity_posts (name, id)
select spec.name, created.id
from created
join spec on created.published_at = statement_timestamp() - spec.age;

insert into private.post_authors (post_id, profile_id)
select post.id, post.timeline_profile_id
from activity_posts
join public.posts as post on post.id = activity_posts.id;

delete from private.feed_sessions;
create temporary table session as
select private.create_feed_session(
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001')
) as id;

create temporary table session_activity as
select activity_posts.name
from private.feed_session_posts as entry
join activity_posts on activity_posts.id = entry.post_id
where entry.session_id = (select id from session);

select ok(
  exists (select 1 from session_activity where name = 'new-avatar'),
  'the latest avatar change reaches the feed'
);

select ok(
  not exists (select 1 from session_activity where name = 'old-avatar'),
  'an earlier avatar change of the same person stays off the feed'
);

select ok(
  exists (select 1 from session_activity where name = 'only-cover'),
  'a cover change is kept apart from avatar changes'
);

select * from finish();
rollback;
