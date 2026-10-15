begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

-- 게시물 공유(기능 명세 §8.13)는 방을 열지 않고 보낸다. 보낸 사람의 읽은 위치를 옮기면 그 방에 와 있던
-- 안 읽은 메시지가 읽음이 되어 배지가 사라진다. 대화방 안에서 보내는 기본 전송은 지금처럼 옮긴다.
-- seed: 홍길동(…0001)과 김민준의 1:1 대화 c…01.

update public.conversation_members as member
set last_read_sent_at = '2000-01-01T00:00:00Z',
  last_read_message_id = '00000000-0000-0000-0000-000000000000'
from public.profiles as profile
where member.conversation_id = 'c0000000-0000-0000-0000-000000000001'
  and member.profile_id = profile.id
  and profile.auth_user_id = '10000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

create temp table before_share as
select unread_count
from public.list_conversations('c0000000-0000-0000-0000-000000000001');

select ok(
  (select unread_count > 0 from before_share),
  'the fixture has unread messages from the other person'
);

select lives_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000001',
      'e1000000-0000-0000-0000-000000000001',
      'https://kmla.online/groups/band/posts/6f1c2a4e-8b3d-4c5e-9a7f-0123456789ab',
      null,
      false
    )$$,
  'a share can send without moving my read position'
);

select is(
  (select unread_count from public.list_conversations('c0000000-0000-0000-0000-000000000001')),
  (select unread_count from before_share),
  'sharing keeps the unread messages that were already waiting'
);

select lives_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000001',
      'e1000000-0000-0000-0000-000000000002',
      '방 안에서 보낸 답'
    )$$,
  'an ordinary send still works with the defaults'
);

select is(
  (select unread_count from public.list_conversations('c0000000-0000-0000-0000-000000000001')),
  0,
  'an ordinary send from the room still marks everything before it read'
);

select * from finish();
rollback;
