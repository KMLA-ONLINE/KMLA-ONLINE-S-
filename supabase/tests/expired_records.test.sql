begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

-- 이 파일이 보는 것은 하나다. 기간이 지난 행만 사라지고 경계 안의 행은 남는가. 보존 기간을
-- 잘못 잡으면 아직 쓰는 데이터가 사라지므로 종류마다 "지워질 것"과 "남을 것"을 짝지어 넣는다.

select ok(
  not has_function_privilege(
    'authenticated', 'private.cleanup_expired_records()', 'EXECUTE'
  ),
  'clients cannot run the retention pass'
);

-- 한국 날짜 기준이라 세계시 자정 근처에서 결과가 달라진다. 함수와 같은 기준을 쓴다.
create temp table korea as
select today,
  -- 노래방 점심 슬롯은 평일만 허용된다. 요일에 따라 fixture 가 깨지지 않도록 월요일에 맞춘다.
  (today - (extract(isodow from today)::integer - 1))::date as monday
from (select (now() at time zone 'Asia/Seoul')::date as today) as base;

insert into public.stories (profile_id, content, created_at)
select
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  sample.content,
  sample.created_at
from (
  select '오늘 스토리' as content,
    (select today from korea)::timestamp at time zone 'Asia/Seoul' as created_at
  union all
  select '어제 스토리',
    ((select today from korea) - 1)::timestamp at time zone 'Asia/Seoul'
  union all
  select '사흘 전 스토리',
    ((select today from korea) - 3)::timestamp at time zone 'Asia/Seoul'
) as sample;

-- 단발 예약은 예약일 기준, 반복 예약은 종료일 기준으로 2주를 센다. 예약 규칙 트리거는 지난
-- 날짜를 거부하므로, 보존 기간만 보는 이 파일에서는 잠시 꺼 두고 과거 행을 직접 넣는다.
alter table public.utility_reservations disable trigger utility_reservations_prepare;
alter table public.gongang_schedule disable trigger gongang_schedule_prepare;

insert into public.utility_reservations (
  profile_id, mode, reservation_date, slot, location, detail, recurring,
  recurring_until, applicant_name
)
select
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  sample.mode, sample.reservation_date, sample.slot, sample.location, sample.detail,
  sample.recurring, sample.recurring_until, '이한별'
from (
  -- 단발은 노래방 평일 점심, 반복은 공강이어야 한다(반복은 gongang 모드만 허용).
  select 'karaoke' as mode, ((select monday from korea) - 21)::date as reservation_date,
    'lunch' as slot, null::text as location, '오래된 단발' as detail,
    false as recurring, null::date as recurring_until
  union all
  select 'karaoke', ((select monday from korea) - 7)::date, 'lunch', null::text,
    '최근 단발', false, null::date
  union all
  select 'gongang', ((select monday from korea) - 42)::date, 'study-2', 'floor_10',
    '끝난 반복', true, ((select monday from korea) - 21)::date
  union all
  select 'gongang', ((select monday from korea) - 42)::date, 'study-1', 'floor_b1',
    '열린 반복', true, null::date
) as sample;

insert into public.gongang_schedule (schedule_date, slot, location, reserved, detail)
values
  ((now() at time zone 'Asia/Seoul')::date - 20, 'study-1', 'floor_2', true, '오래된 일정'),
  ((now() at time zone 'Asia/Seoul')::date - 3, 'study-1', 'floor_4', true, '최근 일정');

alter table public.utility_reservations enable trigger utility_reservations_prepare;
alter table public.gongang_schedule enable trigger gongang_schedule_prepare;

-- 랭킹 이벤트는 append-only 라 정리 경로 밖에서는 넣기만 할 수 있다.
insert into private.post_reaction_count_events (post_id, delta, occurred_at)
values
  ('90000000-0000-0000-0000-000000000001', 1, now() - interval '48 hours'),
  ('90000000-0000-0000-0000-000000000001', 1, now() - interval '1 hour');

insert into private.feed_bump_events (post_id, comment_id, effective_at)
select '90000000-0000-0000-0000-000000000001', comment.id, sample.effective_at
from (
  select now() - interval '10 days' as effective_at, 0 as ordinal
  union all
  select now() - interval '1 hour', 1
) as sample
join lateral (
  select id from public.post_comments
  where post_id = '90000000-0000-0000-0000-000000000001'
  order by id
  offset sample.ordinal limit 1
) as comment on true;

select ok(
  private.cleanup_expired_records() > 0,
  'the retention pass reports what it removed'
);

select is(
  (select count(*)::integer from public.stories),
  2,
  'stories keep today and yesterday'
);
select ok(
  not exists (select 1 from public.stories where content = '사흘 전 스토리'),
  'stories older than two days are gone'
);

select ok(
  exists (
    select 1 from public.utility_reservations where detail = '최근 단발'
  ) and not exists (
    select 1 from public.utility_reservations where detail = '오래된 단발'
  ),
  'one-off reservations are kept for two weeks after their date'
);
select ok(
  not exists (
    select 1 from public.utility_reservations where detail = '끝난 반복'
  ),
  'recurring reservations are counted from the date they stop'
);
select ok(
  exists (
    select 1 from public.utility_reservations where detail = '열린 반복'
  ),
  'a recurring reservation with no end date is never expired'
);

select ok(
  exists (
    select 1 from public.gongang_schedule where detail = '최근 일정'
  ) and not exists (
    select 1 from public.gongang_schedule where detail = '오래된 일정'
  ),
  'gongang schedule rows follow the same two week window'
);

select is(
  (
    select count(*)::integer
    from private.post_reaction_count_events
    where occurred_at < now() - interval '24 hours'
  ),
  0,
  'reaction count events past the ranking window are gone'
);
select is(
  (
    select count(*)::integer
    from private.feed_bump_events
    where post_id = '90000000-0000-0000-0000-000000000001'
  ),
  1,
  'only the most recent bump event survives per post'
);

-- 정리 경로 밖에서는 여전히 지울 수 없어야 한다. 가드는 이 함수 안에서만 열린다.
select throws_ok(
  $$delete from private.feed_bump_events
    where post_id = '90000000-0000-0000-0000-000000000001'$$,
  '55000', 'feed ranking events are append-only',
  'the retention pass does not leave the append-only guard open'
);

select * from finish();
rollback;
