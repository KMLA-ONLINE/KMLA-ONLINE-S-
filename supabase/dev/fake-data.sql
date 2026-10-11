-- 로딩 화면 확인용 대량 가짜 데이터. 로컬 전용이며 `npm run db:fake`가 넣는다.
-- seed.sql에 넣지 않는 이유: pgTAP 테스트가 seed의 행 수를 가정하는 곳이 있어 대량 행이 섞이면 안 된다.
--
-- 모든 행은 `md5('fake-…')::uuid`나 `fake-` 접두사로 정해진 키를 가져 여러 번 넣어도 늘어나지 않는다.
-- 지우려면 `npm run db:reset`.
--
-- 받는 사람은 seed의 로그인 계정 홍길동(student@kmla.hs.kr / password123)이다.

begin;

create temporary table fake_viewer on commit drop as
select id from public.profiles
where auth_user_id = '10000000-0000-0000-0000-000000000001';

do $$
begin
  if not exists (select 1 from fake_viewer) then
    raise exception 'seed 계정(홍길동)이 없습니다. npm run db:reset 뒤에 다시 실행하세요.';
  end if;
end;
$$;

-- 사람 60명. 셋은 오늘이 생일이라 홈 옆 칸의 생일 카드가 보인다.
insert into public.profiles (
  pub_id, name, type, cohort, gender, academic_track, birthday, status, description
)
select
  'fake-p' || lpad(n::text, 2, '0'),
  (array['김','이','박','최','정','강','조','윤','장','임'])[1 + n % 10]
    || (array['민준','서연','도윤','하은','시우','지우','예준','수아','주원','지민','현우','채원'])[1 + n % 12],
  'alumni',
  20 + n % 10,
  (array['male','female'])[1 + n % 2]::public.profile_gender,
  (array['domestic','international'])[1 + (n % 3 = 0)::int]::public.profile_academic_track,
  case
    when n <= 3 then make_date(
      2004,
      extract(month from now() at time zone 'Asia/Seoul')::int,
      extract(day from now() at time zone 'Asia/Seoul')::int
    )
    else make_date(2004, 1 + n % 12, 1 + n % 28)
  end,
  'accepted',
  '가짜 데이터로 만든 프로필입니다.'
from generate_series(1, 60) as n
on conflict (lower(pub_id)) do nothing;

create temporary table fake_people on commit drop as
select row_number() over (order by pub_id) as n, id, name
from public.profiles
where pub_id like 'fake-p%';

-- 그룹 12개. 1–8은 내가 속한 그룹(1·2는 내가 소유), 9–12는 둘러보기에만 보인다.
insert into public.groups (
  id, slug, kind, name, description, join_policy, identity_policy, posting_policy, created_by
)
select
  md5('fake-group-' || n)::uuid,
  'fake-g' || lpad(n::text, 2, '0'),
  'unofficial',
  (array['로딩 시험 동아리','긴 목록 클럽','사진 모임','코딩 스터디','밴드부','토론 모임',
         '독서회','영화 감상','등산 모임','보드게임','요리 연구회','천체 관측'])[n],
  '가짜 데이터 그룹입니다. 게시물·멤버 목록을 길게 채워 두었습니다.',
  case when n = 2 then 'request' else 'open' end::public.group_join_policy,
  case when n % 2 = 1 then 'optional_anonymous' else 'identified' end::public.group_identity_policy,
  'members',
  (select id from fake_viewer)
from generate_series(1, 12) as n
on conflict (id) do nothing;

insert into public.group_memberships (group_id, profile_id, role, pinned_at)
select md5('fake-group-' || n)::uuid, (select id from fake_viewer),
  case when n <= 2 then 'owner' else 'member' end::public.group_member_role,
  case when n = 1 then now() end
from generate_series(1, 8) as n
on conflict (group_id, profile_id) do nothing;

-- 1번 그룹에는 60명 전원(멤버 목록 무한 스크롤), 나머지는 일부만.
insert into public.group_memberships (group_id, profile_id, role)
select md5('fake-group-' || g)::uuid, person.id,
  case
    when g = 1 and person.n <= 2 then 'admin'
    when g = 1 and person.n <= 5 then 'manager'
    else 'member'
  end::public.group_member_role
from generate_series(1, 12) as g
join fake_people as person
  on g = 1 or (g <> 2 and (person.n + g) % 3 = 0) or (g = 2 and person.n <= 15)
on conflict (group_id, profile_id) do nothing;

-- 2번 그룹(가입 승인제)의 가입 요청 20건.
insert into public.group_join_requests (group_id, profile_id, requested_at)
select md5('fake-group-2')::uuid, person.id, now() - person.n * interval '37 minutes'
from fake_people as person
where person.n between 16 and 35
on conflict (group_id, profile_id) do nothing;

insert into public.group_categories (id, group_id, name, position)
select md5('fake-category-' || n)::uuid, md5('fake-group-1')::uuid,
  (array['공지','질문','자료','잡담'])[n], n - 1
from generate_series(1, 4) as n
on conflict (id) do nothing;

-- 게시물. 1번 그룹 320개(목록 페이지 넘김), 2–8번 그룹 25개씩, 내 타임라인 40개.
create temporary table fake_posts on commit drop as
select
  md5('fake-post-' || g || '-' || n)::uuid as id,
  g, n,
  md5('fake-group-' || g)::uuid as group_id,
  -- `n`을 표 이름까지 붙여 쓴다. 그냥 `n`이면 하위 쿼리 안에서 `fake_people.n`으로 읽힌다.
  (select id from fake_people where fake_people.n = 1 + (g.g * 7 + n.n) % 60) as author_id,
  case
    when g % 2 = 1 and n % 7 = 0 then 'anonymous'
    when n % 11 = 0 then 'staff'
    else 'identified'
  end::public.post_identity as author_identity,
  now() - (n * interval '2 hours 13 minutes') - g * interval '7 minutes' as published_at
from generate_series(1, 8) as g
cross join lateral generate_series(1, case when g = 1 then 320 else 25 end) as n;

insert into public.posts (
  id, kind, body, group_id, title, category_id, author_identity,
  display_author_profile_id, created_at, published_at
)
select
  post.id, 'group',
  case post.n % 4
    when 0 then '짧은 본문입니다.'
    when 1 then repeat('로딩 화면을 확인하기 위한 가짜 본문입니다. ', 12)
    when 2 then E'**목록**\n\n- 첫째 항목\n- 둘째 항목\n- 셋째 항목\n\n' || repeat('긴 글이 접혔다가 펼쳐지는지 봅니다. ', 30)
    else '#' || post.g || '번 그룹의 ' || post.n || '번째 글'
  end,
  post.group_id,
  '가짜 글 ' || post.g || '-' || post.n,
  case when post.g = 1 and post.n % 3 <> 0 then md5('fake-category-' || (1 + post.n % 4))::uuid end,
  post.author_identity,
  case when post.author_identity = 'identified' then post.author_id end,
  post.published_at, post.published_at
from fake_posts as post
on conflict (id) do nothing;

insert into private.post_authors (post_id, profile_id)
select id, author_id from fake_posts
on conflict (post_id) do nothing;

insert into public.posts (
  id, kind, body, timeline_profile_id, author_identity,
  display_author_profile_id, visibility, created_at, published_at
)
select
  md5('fake-timeline-' || n)::uuid, 'profile',
  '타임라인 가짜 글 ' || n || '. ' || repeat('오늘 있었던 일을 적어 봅니다. ', 1 + n % 5),
  (select id from fake_viewer), 'identified', (select id from fake_viewer), 'public',
  now() - n * interval '5 hours', now() - n * interval '5 hours'
from generate_series(1, 40) as n
on conflict (id) do nothing;

insert into private.post_authors (post_id, profile_id)
select md5('fake-timeline-' || n)::uuid, (select id from fake_viewer)
from generate_series(1, 40) as n
on conflict (post_id) do nothing;

-- 댓글. 1번 그룹 최신 글에 최상위 150개와 앞쪽 20개마다 답글 2개(댓글 더 보기·답글 펼치기).
-- 다른 글에는 몇 개씩.
create temporary table fake_comments on commit drop as
select
  md5('fake-comment-top-' || n)::uuid as id,
  md5('fake-post-1-1')::uuid as post_id,
  null::uuid as parent_id,
  md5('fake-comment-top-' || n)::uuid as root_id,
  0 as depth,
  1 + n % 60 as person_n,
  now() - interval '2 hours' + n * interval '20 seconds' as created_at,
  '가짜 댓글 ' || n || '번입니다.' as body
from generate_series(1, 150) as n
union all
select
  md5('fake-comment-reply-' || n || '-' || r)::uuid,
  md5('fake-post-1-1')::uuid,
  md5('fake-comment-top-' || n)::uuid,
  md5('fake-comment-top-' || n)::uuid,
  1,
  1 + (n + r * 13) % 60,
  now() - interval '2 hours' + n * interval '20 seconds' + r * interval '1 minute',
  n || '번 댓글에 단 답글 ' || r
from generate_series(1, 20) as n
cross join generate_series(1, 2) as r
union all
select
  md5('fake-comment-' || post.id || '-' || c)::uuid,
  post.id, null, md5('fake-comment-' || post.id || '-' || c)::uuid, 0,
  1 + (post.n + c * 5) % 60,
  post.published_at + c * interval '9 minutes',
  '좋은 글이네요 ' || c
from fake_posts as post
cross join lateral generate_series(1, post.n % 4) as c
where not (post.g = 1 and post.n = 1) and post.n <= 60;

insert into public.post_comments (
  id, post_id, parent_comment_id, root_comment_id, depth, body,
  author_identity, display_author_profile_id, created_at
)
select comment.id, comment.post_id, comment.parent_id, comment.root_id, comment.depth,
  comment.body, 'identified', person.id, comment.created_at
from fake_comments as comment
join fake_people as person on person.n = comment.person_n
on conflict (id) do nothing;

insert into private.comment_authors (comment_id, profile_id)
select comment.id, person.id
from fake_comments as comment
join fake_people as person on person.n = comment.person_n
on conflict (comment_id) do nothing;

-- 반응. 최신 글에는 60명 전원(반응 목록), 다른 글에는 몇 명씩.
insert into public.post_reactions (post_id, profile_id, reaction, created_at)
select post.id, person.id,
  (array['like','love','haha','wow','sad','angry'])[1 + (person.n + post.n) % 6]::public.post_reaction,
  post.published_at + person.n * interval '1 minute'
from fake_posts as post
join fake_people as person
  on (post.g = 1 and post.n = 1) or (post.n <= 80 and person.n <= post.n % 9)
on conflict (post_id, profile_id) do nothing;

-- 내 알림 220개. 최근 60개는 안 읽음. 모두 1번 그룹 글을 가리켜 눌러서 열 수 있다.
insert into public.notifications (
  id, recipient_profile_id, kind, importance, category, actor_identity,
  actor_profile_id, actor_display_name, actor_count, group_id, post_id, title,
  created_at, last_activity_at, read_at
)
select
  md5('fake-notification-' || i)::uuid,
  (select id from fake_viewer),
  kind.kind, kind.importance, kind.category, 'identified',
  person.id, person.name, 1 + i % 4,
  md5('fake-group-1')::uuid,
  md5('fake-post-1-' || (1 + i % 300))::uuid,
  case kind.kind
    when 'post_commented' then person.name || '님이 회원님의 게시물에 댓글을 남겼습니다.'
    when 'post_reacted' then person.name || '님이 회원님의 게시물에 반응을 남겼습니다.'
    when 'comment_replied' then person.name || '님이 회원님의 댓글에 답글을 남겼습니다.'
    else '가짜 글 1-' || (1 + i % 300)
  end,
  now() - i * interval '47 minutes',
  now() - i * interval '47 minutes',
  case when i > 60 then now() - i * interval '47 minutes' + interval '5 minutes' end
from generate_series(1, 220) as i
join fake_people as person on person.n = 1 + i % 60
cross join lateral (
  select
    (array['post_commented','post_reacted','comment_replied','group_posted'])[1 + i % 4]::public.notification_kind as kind,
    (array['normal','low','normal','low'])[1 + i % 4]::public.notification_importance as importance,
    (array['content','content','content','group'])[1 + i % 4]::public.notification_category as category
) as kind
on conflict (id) do nothing;

commit;

select
  (select count(*) from public.profiles where pub_id like 'fake-p%') as people,
  (select count(*) from public.groups where slug like 'fake-g%') as groups,
  (select count(*) from public.posts where id in (select md5('fake-post-' || g || '-' || n)::uuid
     from generate_series(1, 8) as g, generate_series(1, 320) as n)) as group_posts,
  (select count(*) from public.notifications where recipient_profile_id = (
     select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001'))
    as my_notifications;
