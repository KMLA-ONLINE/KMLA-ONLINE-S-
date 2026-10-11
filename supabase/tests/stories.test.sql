begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select ok(
  not has_table_privilege('authenticated', 'public.stories', 'SELECT'),
  'story rows are not directly readable'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);

create temp table story_ids (
  name text primary key, id bigint, object_path text, thumbnail_path text
);
grant all on story_ids to authenticated;

set local role authenticated;

select lives_ok(
  $$select public.create_text_story('오늘 급식이 좋았다', 'blue', 'https://kmla.kr/notice')$$,
  'student can create a text story with a link'
);

select throws_ok(
  $$select public.create_text_story('링크', 'blue', 'javascript:alert(1)')$$,
  '23514',
  null,
  'non-http link is rejected'
);

-- 사진 스토리는 prepare가 예고한 경로에만 올릴 수 있고, publish 전에는 보이지 않는다.
insert into story_ids (name, id, object_path, thumbnail_path)
select 'image', story_id, object_path, thumbnail_path
from public.prepare_image_story(4, 1080, 1920, '사진 위 글');

select ok(
  not exists (
    select 1 from public.list_active_stories()
    where story_id = (select id from story_ids where name = 'image')
  ),
  'pending image story is not listed'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    values (
      'story-media',
      '10000000-0000-0000-0000-000000000001/unprepared',
      '10000000-0000-0000-0000-000000000001',
      '{"size":4,"mimetype":"image/webp"}'
    )$$,
  '42501',
  null,
  'Storage rejects an unprepared path'
);

insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'story-media', path, '10000000-0000-0000-0000-000000000001',
  '{"size":4,"mimetype":"image/webp"}'::jsonb
from story_ids
cross join lateral (values (object_path), (thumbnail_path)) as paths(path)
where name = 'image';

select lives_ok(
  $$select public.publish_image_story((select id from story_ids where name = 'image'))$$,
  'matching upload publishes the image story'
);

select ok(
  exists (
    select 1 from public.list_active_stories()
    where story_id = (select id from story_ids where name = 'image')
  ),
  'published image story is listed'
);

select lives_ok(
  $$select public.delete_my_story((select id from story_ids where name = 'image'))$$,
  'author can delete an own story'
);

reset role;

select ok(
  exists (
    select 1
    from private.storage_cleanup_queue
    where bucket = 'story-media'
      and object_path in (
        select object_path from story_ids where name = 'image'
        union all
        select thumbnail_path from story_ids where name = 'image'
      )
    group by bucket
    having count(*) = 2
  ),
  'deleting an image story queues the photo and its thumbnail'
);

set local role authenticated;

select throws_ok(
  $$select public.create_text_story('스토리 ' || n, 'blue')
    from generate_series(1, 21) as n$$,
  '54000',
  null,
  'a writer cannot keep more than 20 active stories'
);

reset role;

-- 노출은 작성자 유형으로만 갈린다(기능 명세 §6.6).
insert into public.profiles (pub_id, name, type, status)
values ('story-teach', '스토리 쓰는 교사', 'teacher', 'accepted');

insert into public.stories (profile_id, status, content, background, published_at, expires_at)
values
  ((select id from public.profiles where pub_id = 'story-teach'), 'ready', '오늘 교사 스토리',
    'dark', now(), now() + interval '24 hours'),
  ((select id from public.profiles where pub_id = 'story-teach'), 'ready', '만료된 스토리',
    'dark', now() - interval '25 hours', now() - interval '1 hour');

set local role authenticated;

select ok(
  not exists (select 1 from public.list_active_stories() where content = '만료된 스토리'),
  'expired story is excluded'
);

select throws_ok(
  $$select public.delete_my_story(
      (select story_id from public.list_active_stories() where pub_id = 'story-teach' limit 1)
    )$$,
  '42501',
  null,
  'a viewer cannot delete another persons story'
);

reset role;

-- 뷰어를 졸업생으로 바꾼다. 졸업생 프로필은 반과 호실을 비워야 한다.
update public.profiles
set
  type = 'alumni',
  cohort = 29,
  gender = 'male',
  academic_track = 'domestic',
  class_no = null,
  dorm_room = null
where auth_user_id =
  '10000000-0000-0000-0000-000000000001';

set local role authenticated;

select ok(
  not exists (select 1 from public.list_active_stories() where content = '오늘 급식이 좋았다'),
  'alumni viewer does not see student stories'
);

select ok(
  exists (select 1 from public.list_active_stories() where pub_id = 'story-teach'),
  'alumni viewer still sees a teacher story'
);

reset role;

select * from finish();

rollback;
