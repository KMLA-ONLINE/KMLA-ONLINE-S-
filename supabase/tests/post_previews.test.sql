begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

-- 메시지 안 게시물 카드(기능 명세 §13.21). 보는 사람 = 시드 학생(홍길동, profile 1).
--   29기 수학 탐구(…0002)는 멤버, 메이커스 랩(…0003)은 비멤버다.
--   이한별(profile 4)·박새벽(profile 5)이 글을 쓴다. 게시 RPC 대신 행을 직접 넣어 읽기 판정만 본다.
create temp table ids (name text primary key, id uuid);
grant select on table ids to authenticated;

insert into ids (name, id) values
  ('member_identified', gen_random_uuid()),
  ('member_anonymous', gen_random_uuid()),
  ('outsider_group', gen_random_uuid()),
  ('public_profile', gen_random_uuid()),
  ('private_profile', gen_random_uuid()),
  ('draft', gen_random_uuid());

insert into public.posts (
  id, kind, group_id, timeline_profile_id, title, body, author_identity,
  display_author_profile_id, visibility, published_at
)
values
  ((select id from ids where name = 'member_identified'), 'group',
    '20000000-0000-0000-0000-000000000002', null, '적분 질문', '**본문** 첫 줄',
    'identified', 4, null, now()),
  ((select id from ids where name = 'member_anonymous'), 'group',
    '20000000-0000-0000-0000-000000000002', null, '익명 글', '누가 썼을까',
    'anonymous', null, null, now()),
  ((select id from ids where name = 'outsider_group'), 'group',
    '20000000-0000-0000-0000-000000000003', null, '비밀 글', '멤버만',
    'identified', 4, null, now()),
  ((select id from ids where name = 'public_profile'), 'profile',
    null, 5, null, '전체 공개 글', 'identified', 5, 'public', now()),
  ((select id from ids where name = 'private_profile'), 'profile',
    null, 5, null, '나만 보기', 'identified', 5, 'private', now()),
  ((select id from ids where name = 'draft'), 'group',
    '20000000-0000-0000-0000-000000000002', null, '초안', '아직',
    'identified', 4, null, null);

insert into private.post_authors (post_id, profile_id)
select id, case when name in ('public_profile', 'private_profile') then 5 else 4 end
from ids;

-- 첫 사진은 썸네일로 쓴다. 파일과 준비 안 된 사진은 고르지 않는다.
insert into public.post_attachments (
  id, post_id, object_path, thumbnail_path, original_filename, position,
  mime_type, size_bytes, width, height, status, ready_at
)
select
  attachment.id, post.id, post.id::text || '/' || attachment.id::text,
  case when attachment.mime like 'image/%'
    then post.id::text || '/' || attachment.id::text || '/thumb' end,
  attachment.filename, attachment.position, attachment.mime, 10,
  case when attachment.mime like 'image/%' then 10 end,
  case when attachment.mime like 'image/%' then 10 end,
  attachment.status::public.post_attachment_status,
  case when attachment.status = 'ready' then now() end
from ids as post
cross join (values
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'notes.pdf', -2, 'application/pdf', 'ready'),
  ('a0000000-0000-0000-0000-000000000002'::uuid, 'wip.jpg', -1, 'image/jpeg', 'pending'),
  ('a0000000-0000-0000-0000-000000000003'::uuid, 'cover.jpg', 0, 'image/jpeg', 'ready'),
  ('a0000000-0000-0000-0000-000000000004'::uuid, 'second.jpg', 1, 'image/jpeg', 'ready')
) as attachment (id, filename, position, mime, status)
where post.name = 'member_identified';

set local role anon;
select throws_ok(
  $$select * from public.list_post_previews(array[gen_random_uuid()])$$,
  '42501', null, 'anonymous visitors cannot read post previews'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

create temp table previews as
select * from public.list_post_previews(array(
  select id from ids union all select gen_random_uuid()
));

select is(
  (select array_agg(ids.name order by ids.name) from previews join ids on ids.id = previews.post_id),
  array['member_anonymous', 'member_identified', 'public_profile'],
  'only posts the viewer can read come back; outsider groups, private timelines, drafts and unknown ids are left out'
);

select is(
  (select kind::text from previews where post_id = (select id from ids where name = 'member_identified')),
  'group', 'a group post says it is a group post'
);
select is(
  (select group_name from previews where post_id = (select id from ids where name = 'member_identified')),
  '29기 수학 탐구', 'a group post carries its group name'
);
select is(
  (select title from previews where post_id = (select id from ids where name = 'member_identified')),
  '적분 질문', 'a group post carries its title'
);
select is(
  (select author_label from previews where post_id = (select id from ids where name = 'member_identified')),
  '이한별', 'an identified post shows its author name'
);
select is(
  (select image_path from previews where post_id = (select id from ids where name = 'member_identified')),
  (select id::text from ids where name = 'member_identified') || '/a0000000-0000-0000-0000-000000000003/thumb',
  'the card image is the thumbnail of the first ready photo'
);

select is(
  (select author_label from previews where post_id = (select id from ids where name = 'member_anonymous')),
  '익명', 'an anonymous post shows only the anonymous label'
);
select ok(
  (select author_avatar_path is null from previews where post_id = (select id from ids where name = 'member_anonymous')),
  'an anonymous post does not leak the author avatar'
);

select is(
  (select group_name from previews where post_id = (select id from ids where name = 'public_profile')),
  null, 'a profile post has no group name'
);
select is(
  (select body from previews where post_id = (select id from ids where name = 'public_profile')),
  '전체 공개 글', 'a profile post carries its body'
);
select ok(
  (select image_path is null from previews where post_id = (select id from ids where name = 'public_profile')),
  'a post without photos has no card image'
);

select * from finish();
rollback;
