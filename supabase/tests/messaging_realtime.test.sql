begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

-- seed: 홍길동(…0001)과 김민준(…0100)의 1:1 대화 c…01. d…01은 김민준, d…02는 홍길동의 메시지다.
create temp table profile_ids as
select
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001') as hong,
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000100') as minjun;
grant select on profile_ids to authenticated;

create temp table marks (name text primary key, at timestamptz);
grant all on marks to authenticated;

-- 이 트랜잭션 안의 신호만 센다. `inserted_at`은 트랜잭션 시작 시각이라 시각으로는 가를 수 없다.
create temp table earlier_signals as select id from realtime.messages;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select public.send_message(
  'c0000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000300',
  '실시간 메시지'
);

reset role;

select results_eq(
  $$select topic, event, payload - 'id'
    from realtime.messages
    where id not in (select id from earlier_signals)
      and event = 'message_changed'
    order by topic$$,
  $$select topic, 'message_changed'::text, jsonb_build_object(
      'conversation_id', 'c0000000-0000-0000-0000-000000000001'::uuid,
      'message_id', 'e0000000-0000-0000-0000-000000000300'::uuid,
      'kind', 'content'
    )
    from (values
      ('messaging:' || (select hong from profile_ids)),
      ('messaging:' || (select minjun from profile_ids))
    ) as topics(topic)
    order by topic$$,
  'a new message signals every current member with ids only'
);

select ok(
  not exists (
    select 1
    from realtime.messages
    where id not in (select id from earlier_signals)
      and payload::text like '%실시간%'
  ),
  'signals never carry the message body'
);

select results_eq(
  $$select topic
    from realtime.messages
    where id not in (select id from earlier_signals)
      and event = 'read_changed'$$,
  $$values ('messaging:' || (select minjun from profile_ids))$$,
  'moving my read position signals the other members only'
);

-- 바뀐 시각

insert into marks
select 'before_reaction', changed_at
from private.messages
where id = 'd0000000-0000-0000-0000-000000000001';

set local role authenticated;
select public.set_message_reaction('d0000000-0000-0000-0000-000000000001', 'like');
reset role;

select ok(
  (select changed_at from private.messages where id = 'd0000000-0000-0000-0000-000000000001')
    > (select at from marks where name = 'before_reaction'),
  'a reaction moves the message changed time'
);

select is(
  (
    select array_agg(distinct payload ->> 'kind')
    from realtime.messages
    where id not in (select id from earlier_signals)
      and payload ->> 'message_id' = 'd0000000-0000-0000-0000-000000000001'
  ),
  array['meta'],
  'a reaction signals a meta change so the conversation list is not refetched'
);

insert into marks
select 'before_pin', changed_at
from private.messages
where id = 'd0000000-0000-0000-0000-000000000001';

set local role authenticated;
select public.set_message_pinned('d0000000-0000-0000-0000-000000000001', true);
reset role;

select ok(
  (select changed_at from private.messages where id = 'd0000000-0000-0000-0000-000000000001')
    > (select at from marks where name = 'before_pin'),
  'a pin moves the message changed time'
);

-- 반응과 고정이 있는 메시지를 지워도 멤버마다 신호는 한 번이다.
create temp table before_delete as select id from realtime.messages;
set local role authenticated;
select public.set_message_reaction('e0000000-0000-0000-0000-000000000300', 'like');
reset role;
truncate before_delete;
insert into before_delete select id from realtime.messages;
set local role authenticated;
select public.delete_messages(array['e0000000-0000-0000-0000-000000000300']::uuid[]);
reset role;

select is(
  (select count(*) from realtime.messages
    where id not in (select id from before_delete)
      and event = 'message_changed'
      and payload ->> 'message_id' = 'e0000000-0000-0000-0000-000000000300'),
  2::bigint,
  'deleting a message with reactions signals each of the two members once'
);

-- 운영 작업은 신호와 바뀐 시각 갱신을 끌 수 있다.

create temp table quiet_before as select id from realtime.messages;
insert into marks
select 'before_quiet', changed_at
from private.messages
where id = 'd0000000-0000-0000-0000-000000000002';

set local messaging.suppress_signals = 'on';
update private.messages
set edited_at = edited_at
where id = 'd0000000-0000-0000-0000-000000000002';
set local messaging.suppress_signals = 'off';

select is(
  (select count(*) from realtime.messages where id not in (select id from quiet_before)),
  0::bigint,
  'suppressed maintenance writes send no signals'
);

select is(
  (select changed_at from private.messages where id = 'd0000000-0000-0000-0000-000000000002'),
  (select at from marks where name = 'before_quiet'),
  'suppressed maintenance writes keep the changed time'
);

-- 따라잡기

-- seed 메시지의 바뀐 시각을 과거로 돌려 "그 뒤에 바뀐 것"만 남긴다.
update private.messages
set changed_at = '2026-08-01 00:00:00+00'
where conversation_id = 'c0000000-0000-0000-0000-000000000001'
  and id <> 'd0000000-0000-0000-0000-000000000001';

set local role authenticated;

select results_eq(
  $$select id, my_reaction, pinned
    from public.list_message_changes(
      'c0000000-0000-0000-0000-000000000001', '2026-09-01 00:00:00+00'
    )$$,
  $$values ('d0000000-0000-0000-0000-000000000001'::uuid, 'like'::public.post_reaction, true)$$,
  'catch-up returns only messages changed after the cursor, with their current state'
);

select is(
  (select count(*) from public.list_message_changes(
    'c0000000-0000-0000-0000-000000000001', '2026-09-01 00:00:00+00', 1
  )),
  1::bigint,
  'catch-up stops at the limit'
);

select throws_ok(
  $$select * from public.list_message_changes('c0000000-0000-0000-0000-000000000001', null)$$,
  '22023',
  null,
  'catch-up needs a cursor'
);

-- 다른 대화 멤버가 아니면 아무것도 받지 않는다.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;

select is(
  (select count(*) from public.list_message_changes(
    'c0000000-0000-0000-0000-000000000002', '2026-01-01 00:00:00+00'
  ) where id = 'd0000000-0000-0000-0000-000000000011'),
  1::bigint,
  'a member catches up on their conversation'
);

-- 읽지 않은 수

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select results_eq(
  $$select id, unread_member_count
    from public.list_message_read_counts(
      'c0000000-0000-0000-0000-000000000001',
      array[
        'd0000000-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-000000000002',
        'e0000000-0000-0000-0000-000000000300'
      ]::uuid[]
    )
    order by id$$,
  $$values
    ('d0000000-0000-0000-0000-000000000001'::uuid, 0),
    ('d0000000-0000-0000-0000-000000000002'::uuid, 1),
    ('e0000000-0000-0000-0000-000000000300'::uuid, 1)$$,
  'read counts leave out the sender and the caller'
);

select results_eq(
  $$select id, unread_member_count
    from public.list_message_read_counts(
      'c0000000-0000-0000-0000-000000000002',
      array['d0000000-0000-0000-0000-000000000013']::uuid[]
    )$$,
  $$values ('d0000000-0000-0000-0000-000000000013'::uuid, 2)$$,
  'in a group the count also covers messages from other members'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;

-- 구독 권한

select set_config('realtime.topic', 'messaging:' || (select minjun from profile_ids), true);

select ok(
  exists (
    select 1
    from realtime.messages
    where topic = 'messaging:' || (select minjun from profile_ids)
  ),
  'a member reads signals on their own topic'
);

select set_config('realtime.topic', 'messaging:' || (select hong from profile_ids), true);

select is(
  (select count(*) from realtime.messages where topic like 'messaging:%'),
  0::bigint,
  'nobody reads another member''s topic'
);

select * from finish();

rollback;
