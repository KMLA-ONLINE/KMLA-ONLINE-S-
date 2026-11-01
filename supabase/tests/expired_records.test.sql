begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

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

-- 스토리는 게시 후 24시간이 지나면 지운다. 사진을 publish하지 못한 행은 48시간을 기다린다.
insert into public.stories (
  profile_id, status, content, background, image_path, thumbnail_path, image_size_bytes,
  image_width, image_height, created_at, published_at, expires_at
)
select
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  sample.*
from (
  values
    ('ready'::public.story_status, '살아 있는 스토리', 'blue', null::text, null::text,
      null::bigint,
      null::integer, null::integer, now() - interval '23 hours', now() - interval '23 hours',
      now() + interval '1 hour'),
    ('ready', '만료된 스토리', 'blue', null, null, null, null, null,
      now() - interval '25 hours', now() - interval '25 hours', now() - interval '1 hour'),
    ('ready', '만료된 사진 스토리', null, 'retention/expired-photo',
      'retention/expired-photo-thumb', 4, 10, 10,
      now() - interval '25 hours', now() - interval '25 hours', now() - interval '1 hour'),
    ('pending', '업로드 중', null, 'retention/uploading', 'retention/uploading-thumb', 4,
      10, 10,
      now() - interval '1 hour', null, null),
    ('pending', '버려진 업로드', null, 'retention/abandoned', 'retention/abandoned-thumb', 4,
      10, 10,
      now() - interval '49 hours', null, null)
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

insert into public.gongang_schedule (
  schedule_date, slot, location, reserved, detail, recurring, recurring_until
)
values
  ((now() at time zone 'Asia/Seoul')::date - 20, 'study-1', 'floor_2', true, '오래된 일정',
    false, null),
  ((now() at time zone 'Asia/Seoul')::date - 3, 'study-1', 'floor_4', true, '최근 일정',
    false, null),
  ((now() at time zone 'Asia/Seoul')::date - 42, 'study-2', 'floor_2', true, '끝난 반복 일정',
    true, (now() at time zone 'Asia/Seoul')::date - 21),
  ((now() at time zone 'Asia/Seoul')::date - 42, 'study-2', 'floor_4', true, '열린 반복 일정',
    true, null);

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

-- 메시지 첨부 보존: 사진을 뺀 종류에서 500KB를 넘고 1년이 지난 것만 파일을 지운다.
insert into private.message_attachments (
  conversation_id, message_id, status, position, kind, mime_type, size_bytes,
  width, height, object_path, thumbnail_path, filename_ciphertext, key_version, created_at
)
select
  'c0000000-0000-0000-0000-000000000001',
  (
    select message.id
    from private.messages as message
    where message.conversation_id = 'c0000000-0000-0000-0000-000000000001'
      and message.deleted_at is null
    order by message.sent_at desc
    limit 1
  ),
  'ready',
  -- 시드 메시지의 첨부와 순서가 겹치지 않게 뒤쪽 번호를 쓴다.
  (100 + row_number() over ())::smallint,
  sample.kind, sample.mime_type, sample.size_bytes,
  sample.width, sample.height, 'retention/' || sample.name, sample.thumbnail_path,
  '\x00'::bytea, 1, sample.created_at
from (values
  ('old-file', 'file', 'application/zip', 512001::bigint, null::integer, null::integer, null::text, now() - interval '1 year 1 day'),
  ('old-audio', 'audio', 'audio/mpeg', 512001, null, null, null, now() - interval '1 year 1 day'),
  ('old-video', 'video', 'video/mp4', 512001, 10, 10, 'retention/old-video/thumb', now() - interval '1 year 1 day'),
  ('old-gif', 'gif', 'video/mp4', 512001, 10, 10, null, now() - interval '1 year 1 day'),
  ('old-small', 'file', 'application/pdf', 512000, null, null, null, now() - interval '1 year 1 day'),
  ('old-image', 'image', 'image/webp', 512001, 10, 10, null, now() - interval '1 year 1 day'),
  ('recent-file', 'file', 'application/zip', 512001, null, null, null, now() - interval '11 months')
) as sample(name, kind, mime_type, size_bytes, width, height, thumbnail_path, created_at);

select ok(
  private.cleanup_expired_records() > 0,
  'the retention pass reports what it removed'
);

select is(
  (
    select array_agg(object_path order by object_path)
    from private.message_attachments
    where object_path like 'retention/%' and status = 'expired'
  ),
  array['retention/old-audio', 'retention/old-file', 'retention/old-gif', 'retention/old-video'],
  'only non-photo attachments over 500KB and past a year expire'
);
select is(
  (
    select array_agg(object_path order by object_path)
    from private.message_attachments
    where object_path like 'retention/%' and status = 'ready'
  ),
  array['retention/old-image', 'retention/old-small', 'retention/recent-file'],
  'photos, files up to 500KB and recent files stay'
);
select is(
  (
    select array_agg(object_path order by object_path)
    from private.storage_cleanup_queue
    where bucket = 'message-attachments' and object_path like 'retention/%'
  ),
  array['retention/old-audio', 'retention/old-file', 'retention/old-gif', 'retention/old-video'],
  'only the expired files are queued, and the video first frame is kept'
);

-- 만료 첨부의 읽기 판정: 파일은 막히고 첫 프레임은 열린다. 이 대화에 참여 중인 홍길동으로 확인한다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select is(
  private.can_read_message_object('retention/old-video'),
  false,
  'an expired file can no longer be read'
);
select is(
  private.can_read_message_object('retention/old-video/thumb'),
  true,
  'the first frame of an expired video stays readable'
);

select is(
  -- 로컬에서 앱을 쓰며 남긴 스토리가 섞이지 않도록 이 파일이 넣은 행만 본다.
  (
    select array_agg(content order by content)
    from public.stories
    where content in (
      '살아 있는 스토리', '만료된 스토리', '만료된 사진 스토리', '업로드 중', '버려진 업로드'
    )
  ),
  array['살아 있는 스토리', '업로드 중'],
  'only live stories and recent uploads remain'
);
select is(
  (
    select array_agg(object_path order by object_path)
    from private.storage_cleanup_queue
    where reason = 'story_media'
      and object_path like 'retention/%'
  ),
  array[
    'retention/abandoned',
    'retention/abandoned-thumb',
    'retention/expired-photo',
    'retention/expired-photo-thumb'
  ],
  'deleted photo stories queue their photos and thumbnails'
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
select ok(
  exists (
    select 1 from public.gongang_schedule where detail = '열린 반복 일정'
  ) and not exists (
    select 1 from public.gongang_schedule where detail = '끝난 반복 일정'
  ),
  'recurring gongang schedules are counted from the date they stop'
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
