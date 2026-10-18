-- 로딩 화면 확인용 대량 가짜 데이터. 로컬 전용이며 `npm run db:fake`가 넣는다.
-- seed.sql에 넣지 않는 이유: pgTAP 테스트가 seed의 행 수를 가정하는 곳이 있어 대량 행이 섞이면 안 된다.
--
-- 모든 행은 `md5('fake-…')::uuid`나 `fake-` 접두사로 정해진 키를 가져 여러 번 넣어도 늘어나지 않는다.
-- 지우려면 `npm run db:reset`.
--
-- 받는 사람은 seed의 로그인 계정 홍길동(student@kmla.hs.kr / password123)이다. 메시지 대화도 홍길동의 것이다.

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

-- 메시지. 1:1 대화 30개(1번은 메시지 400개라 위로 올려 이전 메시지를 불러온다), 그룹 대화 3개(1번은
-- 61명이라 읽음 수와 멤버 목록이 길다, 3번은 알림을 꺼 두었다). 대화마다 안 읽은 메시지가 섞여 있다.
-- 본문은 seed와 같이 `private.encrypt_message_text`로 암호화해 넣는다.
create temporary table fake_conversations on commit drop as
select
  md5('fake-direct-' || person.n)::uuid as id,
  'direct'::public.conversation_type as type,
  null::text as name,
  case when person.n = 1 then 400 else 1 + person.n % 6 end as message_count,
  now() - person.n * interval '2 hours' as last_sent_at,
  case when person.n = 1 then interval '13 minutes' else interval '7 minutes' end as gap,
  person.n as person_n,
  null::int as g
from fake_people as person
where person.n <= 30
union all
select
  md5('fake-group-chat-' || g)::uuid,
  'group',
  (array['가짜 단톡 전체', '가짜 단톡 기획', '가짜 단톡 조용'])[g],
  (array[300, 40, 20])[g],
  now() - g * interval '25 minutes',
  interval '19 minutes',
  null,
  g
from generate_series(1, 3) as g;

insert into public.conversations (
  id, type, name, created_by, direct_profile_low, direct_profile_high, created_at
)
select
  conversation.id,
  conversation.type,
  conversation.name,
  (select id from fake_viewer),
  case when conversation.type = 'direct'
    then least((select id from fake_viewer), person.id) end,
  case when conversation.type = 'direct'
    then greatest((select id from fake_viewer), person.id) end,
  conversation.last_sent_at - conversation.message_count * conversation.gap - interval '1 day'
from fake_conversations as conversation
left join fake_people as person on person.n = conversation.person_n
-- 앱에서 같은 사람과 이미 1:1 대화를 열었으면 그 대화를 두고 넘어간다.
on conflict do nothing;

-- 넣지 못한 1:1 대화는 이후 단계에서 뺀다.
delete from fake_conversations as conversation
where not exists (
  select 1 from public.conversations as existing where existing.id = conversation.id
);

-- 멤버. 1:1은 나와 상대, 그룹 1은 60명 전원, 2는 8명, 3은 7명이다.
create temporary table fake_members on commit drop as
select conversation.id as conversation_id, (select id from fake_viewer) as profile_id,
  conversation.g, 0 as member_n
from fake_conversations as conversation
union all
select conversation.id, person.id, conversation.g, person.n
from fake_conversations as conversation
join fake_people as person
  on (conversation.type = 'direct' and person.n = conversation.person_n)
  or (conversation.g = 1)
  or (conversation.g = 2 and person.n <= 8)
  or (conversation.g = 3 and person.n between 9 and 15);

insert into public.conversation_members (
  conversation_id, profile_id, joined_at, last_read_sent_at, muted_until
)
select
  member.conversation_id,
  member.profile_id,
  conversation.last_sent_at - conversation.message_count * conversation.gap - interval '1 day',
  conversation.last_sent_at - conversation.message_count * conversation.gap - interval '1 day',
  case when member.member_n = 0 and conversation.g = 3 then 'infinity'::timestamptz end
from fake_members as member
join fake_conversations as conversation on conversation.id = member.conversation_id
on conflict do nothing;

create temporary table fake_messages on commit drop as
select
  md5('fake-message-' || conversation.id || '-' || i)::uuid as id,
  conversation.id as conversation_id,
  i,
  conversation.last_sent_at - (conversation.message_count - i) * conversation.gap as sent_at,
  case
    when conversation.type = 'direct' then
      case when (i * 7) % 3 = 0 then (select id from fake_viewer) else person.id end
    when i % 5 = 0 then (select id from fake_viewer)
    else (select id from fake_people where n = 1 + (i * 13 + conversation.g) % 60)
  end as sender_id,
  case when i % 17 = 0 and i > 3
    then md5('fake-message-' || conversation.id || '-' || (i - 3))::uuid end as reply_to_id,
  case
    when i % 50 = 0 then repeat('긴 메시지가 말풍선 안에서 어떻게 줄바꿈되는지 확인하는 문장입니다. ', 8)
    when i % 23 = 0 then (array['👍', '😂😂', '🎉🎉🎉'])[1 + i % 3]
    when i % 31 = 0 then '공지 확인해 주세요 https://www.kmlaonline.net'
    else (array[
      '내일 자습 끝나고 도서관 갈래?', '좋아, 9시에 앞에서 보자', '과제 범위 어디까지야?',
      '방금 공지 올라왔어', '점심 뭐 먹을래?', '오늘 동아리 모임 있어?', '나 5분 늦을 것 같아',
      '사진 확인했어!', '그거 내가 정리해서 올릴게', '고마워 👍', '수행평가 언제까지지?',
      '체육관 예약했어', '회의록 공유 부탁해', '내일 봐!'
    ])[1 + (i * 5 + coalesce(conversation.person_n, conversation.g)) % 14]
  end as body
from fake_conversations as conversation
left join fake_people as person on person.n = conversation.person_n
cross join lateral generate_series(1, conversation.message_count) as i;

-- 그룹 2·3에서 멤버가 아닌 사람이 보낸 것으로 나온 메시지는 그 그룹의 멤버에게 돌린다.
update fake_messages as message
set sender_id = (
  select member.profile_id
  from fake_members as member
  where member.conversation_id = message.conversation_id
    and member.member_n > 0
  order by member.member_n
  offset message.i % (
    select count(*) from fake_members as counted
    where counted.conversation_id = message.conversation_id and counted.member_n > 0
  )
  limit 1
)
where not exists (
  select 1 from fake_members as member
  where member.conversation_id = message.conversation_id
    and member.profile_id = message.sender_id
);

insert into private.messages (
  id, conversation_id, sender_id, sent_at, reply_to_id, body_ciphertext, key_version
)
select
  message.id, message.conversation_id, message.sender_id, message.sent_at,
  message.reply_to_id, encrypted.ciphertext, encrypted.key_version
from fake_messages as message
cross join lateral private.encrypt_message_text(message.body, private.message_keys()) as encrypted
order by message.sent_at
on conflict (id) do nothing;

-- 그룹 1의 첫 줄은 멤버를 초대한 시스템 메시지다.
insert into private.messages (id, conversation_id, sent_at, system_kind, system_profile_ids)
select
  md5('fake-message-system-' || conversation.id)::uuid,
  conversation.id,
  conversation.last_sent_at - (conversation.message_count + 1) * conversation.gap,
  'member_added',
  array(select person.id from fake_people as person where person.n <= 5 order by person.n)
from fake_conversations as conversation
where conversation.g = 1
on conflict (id) do nothing;

-- 반응과 고정. 일곱 번째 메시지마다 몇 명이 반응하고, 큰 대화방마다 두 개를 고정한다.
insert into private.message_reactions (message_id, profile_id, reaction, created_at)
select message.id, member.profile_id,
  (array['like','love','haha','wow','sad','angry'])[1 + (message.i + member.member_n) % 6]::public.post_reaction,
  message.sent_at + interval '1 minute'
from fake_messages as message
join fake_members as member
  on member.conversation_id = message.conversation_id
  and member.profile_id is distinct from message.sender_id
  and member.member_n <= 1 + message.i % 4
where message.i % 7 = 0
on conflict (message_id, profile_id) do nothing;

insert into private.message_pins (message_id, conversation_id, pinned_by, pinned_at)
select message.id, message.conversation_id, (select id from fake_viewer), message.sent_at + interval '5 minutes'
from fake_messages as message
join fake_conversations as conversation on conversation.id = message.conversation_id
where conversation.message_count >= 40 and message.i in (12, conversation.message_count - 8)
on conflict (message_id) do nothing;

-- 읽음 위치. 나는 대화 셋 중 하나에서 마지막 세 개를 안 읽었다. 다른 멤버는 여섯 중 하나꼴로 끝까지
-- 읽었고 나머지는 최근 몇 개를 덜 읽어, 그룹의 읽음 수가 메시지마다 다르게 보인다.
update public.conversation_members as member
set last_read_sent_at = conversation.last_sent_at + interval '1 second'
    - case
        when member.profile_id = (select id from fake_viewer)
          then case when abs(hashtext(conversation.id::text)) % 3 = 0 then 3 else 0 end
        else (abs(hashtext(member.profile_id::text)) % 6)
      end * conversation.gap,
  last_read_message_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
from fake_conversations as conversation
where member.conversation_id = conversation.id
  and member.left_at is null
  and member.last_read_message_id = '00000000-0000-0000-0000-000000000000';

-- 스토리. 쓰고 보는 건 재학생·교사뿐이라 위의 졸업생 60명으로는 안 된다. 재학생 16명을 따로 두고
-- 1–3장씩 올려 홈 레일이 화면 폭을 넘치게 한다(데스크톱 넘김 버튼 확인). 홍길동의 스토리 둘에는
-- 읽은 사람과 반응을 잔뜩 달아 읽은 사람 목록이 길게 스크롤된다.
-- 스토리는 24시간 뒤 만료되므로 다시 넣을 때마다 게시 시각을 지금 기준으로 당겨 놓는다.
insert into public.profiles (
  pub_id, name, type, student_number, cohort, gender, academic_track, birthday, status, description
)
select
  'fake-s' || lpad(n::text, 2, '0'),
  (array['한','오','서','신','권','황','안','송'])[1 + n % 8]
    || (array['다은','시윤','유진','준서','하린','태윤','소율','건우'])[1 + (n * 3) % 8],
  'student',
  '99' || lpad(n::text, 4, '0'),
  28 + n % 3,
  (array['male','female'])[1 + n % 2]::public.profile_gender,
  (array['domestic','international'])[1 + (n % 4 = 0)::int]::public.profile_academic_track,
  make_date(2008, 1 + n % 12, 1 + n % 28),
  'accepted',
  '가짜 데이터로 만든 재학생 프로필입니다.'
from generate_series(1, 16) as n
on conflict (lower(pub_id)) do nothing;

create temporary table fake_story_writers on commit drop as
select row_number() over (order by pub_id) as n, id
from public.profiles
where pub_id like 'fake-s%';

-- id는 900000번대로 고정한다. 1–2는 홍길동, 그 뒤는 작성자 n의 k번째 장(900000 + n*10 + k).
create temporary table fake_stories on commit drop as
select
  900000 + writer.n * 10 + k as id,
  writer.id as profile_id,
  -- 작성자마다 올린 시각을 달리해 레일 순서가 섞이게 한다.
  now() - (writer.n * 17 + (3 - k) * 5) * interval '1 minute' as published_at,
  (array['오늘 급식 맛있다','기숙사 점호 5분 전','도서관 자리 있음?','운동장 노을 미쳤다',
         '시험 끝!!','동아리 공연 보러 와','비 온다 우산 챙겨','밤샘 과제 중'])[1 + (writer.n + k) % 8]
    as content,
  (array['blue','purple','pink','orange','green','dark'])[1 + (writer.n + k) % 6] as background
from fake_story_writers as writer
cross join generate_series(1, 3) as k
where k <= 1 + writer.n % 3
union all
select
  900000 + k,
  (select id from fake_viewer),
  now() - (40 - k * 20) * interval '1 minute',
  (array['읽은 사람 목록 길게 보기','반응 많이 받은 스토리'])[k],
  (array['purple','orange'])[k]
from generate_series(1, 2) as k;

insert into public.stories (
  id, profile_id, status, content, background, audience, created_at, published_at, expires_at
)
select id, profile_id, 'ready', content, background, 'everyone',
  published_at, published_at, published_at + interval '24 hours'
from fake_stories
on conflict (id) do update set
  created_at = excluded.created_at,
  published_at = excluded.published_at,
  expires_at = excluded.expires_at;

-- 홍길동의 첫 장은 76명 전원이, 둘째 장은 30명이 봤다.
create temporary table fake_story_audience on commit drop as
select row_number() over (order by pub_id) as n, id
from public.profiles
where pub_id like 'fake-p%' or pub_id like 'fake-s%';

insert into public.story_views (story_id, profile_id, viewed_at)
select story.id, audience.id,
  least(story.published_at + audience.n * interval '15 seconds', now())
from fake_stories as story
join fake_story_audience as audience
  on audience.n <= case story.id when 900001 then 1000 else 30 end
where story.id in (900001, 900002)
on conflict (story_id, profile_id) do update set viewed_at = excluded.viewed_at;

-- 본 사람 셋 중 둘이 반응을 0–5개 보냈다. 한 사람이 여러 종류를 섞어 보낸 줄도 있다.
insert into public.story_reactions (story_id, profile_id, reaction, created_at)
select view.story_id, view.profile_id,
  (array['like','love','haha','wow','sad','angry'])[1 + (audience.n + i * (1 + audience.n % 3)) % 6]
    ::public.post_reaction,
  view.viewed_at + i * interval '2 seconds'
from public.story_views as view
join fake_story_audience as audience on audience.id = view.profile_id
cross join generate_series(1, 5) as i
where view.story_id in (900001, 900002)
  and audience.n % 3 <> 0
  and i <= audience.n % 6
  and not exists (
    select 1 from public.story_reactions as existing
    where existing.story_id = view.story_id and existing.profile_id = view.profile_id
  );

commit;

select
  (select count(*) from public.profiles where pub_id like 'fake-p%') as people,
  (select count(*) from public.groups where slug like 'fake-g%') as groups,
  (select count(*) from public.posts where id in (select md5('fake-post-' || g || '-' || n)::uuid
     from generate_series(1, 8) as g, generate_series(1, 320) as n)) as group_posts,
  (select count(*) from public.notifications where recipient_profile_id = (
     select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001'))
    as my_notifications,
  (select count(*) from public.conversations
    where id in (select md5('fake-direct-' || n)::uuid from generate_series(1, 30) as n)
      or id in (select md5('fake-group-chat-' || g)::uuid from generate_series(1, 3) as g))
    as my_conversations,
  (select count(*) from public.stories where id between 900000 and 999999 and expires_at > now())
    as active_stories,
  (select count(*) from public.story_views where story_id = 900001) as my_story_viewers;
