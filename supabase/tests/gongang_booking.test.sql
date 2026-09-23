begin;

create extension if not exists pgtap with schema extensions;
select plan(41);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000',
  user_id,
  'authenticated',
  'authenticated',
  email,
  '',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now()
from (values
  ('10000000-0000-0000-0000-000000000002'::uuid, 'gongang-manager@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000003'::uuid, 'gongang-user-a@kmla.hs.kr'),
  ('10000000-0000-0000-0000-000000000004'::uuid, 'gongang-user-b@kmla.hs.kr')
) as users(user_id, email);

update public.profiles
set auth_user_id = case pub_id
  when 'kim-admin' then '10000000-0000-0000-0000-000000000002'::uuid
  when 'hanbyeol-25' then '10000000-0000-0000-0000-000000000003'::uuid
  when 'saebyeok-24' then '10000000-0000-0000-0000-000000000004'::uuid
end
where pub_id in ('kim-admin', 'hanbyeol-25', 'saebyeok-24');

insert into public.profile_permissions (profile_id, permission_key)
select id, 'gongang.manage'
from public.profiles
where pub_id = 'kim-admin';

select set_config(
  'test.korea_today',
  ((now() at time zone 'Asia/Seoul')::date)::text,
  true
);
select set_config(
  'test.next_occurrence',
  ((now() at time zone 'Asia/Seoul')::date + 7)::text,
  true
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.utility_reservations'::regclass),
  'utility reservations have RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'public.utility_reservations', 'DELETE'),
  'clients cannot delete reservations directly'
);
select ok(
  has_function_privilege('authenticated', 'public.cancel_utility_reservation(bigint,date)', 'EXECUTE'),
  'accepted clients receive the cancellation RPC'
);
select ok(
  not has_function_privilege('anon', 'public.cancel_utility_reservation(bigint,date)', 'EXECUTE'),
  'anonymous clients cannot execute the cancellation RPC'
);
select ok(
  has_sequence_privilege('authenticated', 'public.utility_reservations_id_seq', 'USAGE'),
  'authenticated clients can generate reservation identities'
);
select ok(
  not has_sequence_privilege('authenticated', 'public.utility_reservations_id_seq', 'SELECT'),
  'authenticated clients cannot inspect the reservation sequence'
);
select ok(
  not has_sequence_privilege('authenticated', 'public.utility_reservations_id_seq', 'UPDATE'),
  'authenticated clients cannot alter the reservation sequence'
);
select ok(
  not has_sequence_privilege('anon', 'public.utility_reservations_id_seq', 'USAGE'),
  'anonymous clients cannot use the reservation sequence'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select lives_ok(
  format(
    $sql$insert into public.utility_reservations
      (profile_id, mode, reservation_date, slot, location, detail, recurring, recurring_until, applicant_name)
      values (0, 'gongang', %L, 'study-1', 'floor_b1', '장기 사용자 우선', true, %L, '')$sql$,
    current_setting('test.korea_today'),
    current_setting('test.korea_today')
  ),
  'every accepted user can create a current-week gongang reservation'
);
select is(
  (select profile_id from public.utility_reservations where location = 'floor_b1'),
  (select id from public.profiles where pub_id = 'hanbyeol-25'),
  'the insert trigger stamps the authenticated profile'
);
select is(
  (select recurring_until from public.utility_reservations where location = 'floor_b1'),
  null::date,
  'clients cannot choose a recurring end date'
);
select throws_ok(
  format(
    $sql$insert into public.utility_reservations
      (profile_id, mode, reservation_date, slot, location, detail, recurring, applicant_name)
      values (0, 'gongang', %L::date - 1, 'study-1', 'floor_2', '과거', false, '')$sql$,
    current_setting('test.korea_today')
  ),
  '22023',
  'utility reservations are limited to the current Korea week',
  'past dates are rejected'
);
select throws_ok(
  format(
    $sql$insert into public.utility_reservations
      (profile_id, mode, reservation_date, slot, location, detail, recurring, applicant_name)
      values (0, 'gongang', %L, 'study-1', 'floor_2', '차주 선점', false, '')$sql$,
    current_setting('test.next_occurrence')
  ),
  '22023',
  'utility reservations are limited to the current Korea week',
  'ordinary users cannot prebook next week'
);
select throws_ok(
  format(
    $sql$insert into public.utility_reservations
      (profile_id, mode, reservation_date, slot, location, detail, recurring, applicant_name)
      values (0, 'gongang', %L, 'hidden-slot', 'floor_2', '잘못된 슬롯', false, '')$sql$,
    current_setting('test.korea_today')
  ),
  '23514', null,
  'unknown slots are rejected by a database constraint'
);
select throws_ok(
  format(
    $sql$insert into public.utility_reservations
      (profile_id, mode, reservation_date, slot, location, detail, recurring, applicant_name)
      values (0, 'gongang', %L, 'study-1', null, '층 없음', false, '')$sql$,
    current_setting('test.korea_today')
  ),
  '23514', null,
  'gongang reservations require a valid location'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;

select throws_ok(
  format(
    $sql$insert into public.utility_reservations
      (profile_id, mode, reservation_date, slot, location, detail, recurring, applicant_name)
      values (0, 'gongang', %L, 'study-1', 'floor_b1', '후순위', false, '')$sql$,
    current_setting('test.korea_today')
  ),
  '23505',
  'reservation slot is already occupied',
  'a recurring reservation blocks a later one-time request'
);
select throws_ok(
  format(
    $sql$insert into public.gongang_schedule
      (schedule_date, slot, location, reserved, detail)
      values (%L, 'study-1', 'floor_b1', true, '권한 없음')$sql$,
    current_setting('test.next_occurrence')
  ),
  '42501',
  'gongang manager permission required',
  'ordinary users cannot manage next week'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select lives_ok(
  format(
    $sql$insert into public.gongang_schedule
      (schedule_date, slot, location, reserved, detail)
      values (%L, 'study-1', 'floor_b1', true, '관리자 행사')$sql$,
    current_setting('test.next_occurrence')
  ),
  'a manager can prebook the matching next-week slot'
);
select is(
  (select recurring_until from public.utility_reservations where location = 'floor_b1'),
  current_setting('test.next_occurrence')::date,
  'manager prebooking terminates an existing recurrence from that occurrence'
);
select lives_ok(
  format(
    $sql$insert into public.gongang_schedule
      (schedule_date, slot, location, reserved, detail)
      values (%L, 'study-2', 'floor_2', true, '관리자 우선')$sql$,
    current_setting('test.next_occurrence')
  ),
  'manager prebooking can be created before a recurring reservation'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select lives_ok(
  format(
    $sql$insert into public.utility_reservations
      (profile_id, mode, reservation_date, slot, location, detail, recurring, applicant_name)
      values (0, 'gongang', %L, 'study-2', 'floor_2', '이번 주까지만', true, '')$sql$,
    current_setting('test.korea_today')
  ),
  'a new recurrence remains usable this week when a manager already owns next week'
);
select is(
  (select recurring_until from public.utility_reservations where location = 'floor_2'),
  current_setting('test.next_occurrence')::date,
  'manager-first and recurrence-first writes produce the same end date'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok(
  format(
    $sql$insert into public.gongang_schedule
      (schedule_date, slot, location, reserved, detail)
      values (%L, 'honjeong-end', 'floor_4', true, null)$sql$,
    current_setting('test.next_occurrence')
  ),
  '23514', null,
  'reserved manager slots require a nonempty detail'
);
select throws_ok(
  format(
    $sql$insert into public.gongang_schedule
      (schedule_date, slot, location, reserved, detail)
      values (%L, 'honjeong-end', 'floor_4', true, '이번 주')$sql$,
    current_setting('test.korea_today')
  ),
  '22023',
  'only next week can be configured',
  'managers cannot configure the current week'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select lives_ok(
  format(
    $sql$insert into public.utility_reservations
      (profile_id, mode, reservation_date, slot, location, detail, recurring, applicant_name)
      values (0, 'gongang', %L, 'honjeong-end', 'floor_10', '취소할 장기', true, '')$sql$,
    current_setting('test.korea_today')
  ),
  'an owner can create another recurring reservation'
);
select set_config(
  'test.cancel_reservation_id',
  (select id::text from public.utility_reservations where location = 'floor_10'),
  true
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;

select throws_ok(
  format(
    $sql$select public.cancel_utility_reservation(%s, %L)$sql$,
    current_setting('test.cancel_reservation_id'),
    current_setting('test.korea_today')
  ),
  '42501',
  'reservation not found',
  'another user cannot cancel the reservation'
);
select is(
  (select count(*) from public.utility_reservations where id = current_setting('test.cancel_reservation_id')::bigint),
  1::bigint,
  'a denied cancellation leaves the reservation intact'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select lives_ok(
  format(
    $sql$select public.cancel_utility_reservation(%s, %L)$sql$,
    current_setting('test.cancel_reservation_id'),
    current_setting('test.korea_today')
  ),
  'the owner can end a recurrence from the selected occurrence'
);
select is(
  (select recurring_until from public.utility_reservations where id = current_setting('test.cancel_reservation_id')::bigint),
  current_setting('test.korea_today')::date,
  'recurring cancellation preserves the row and stores an exclusive end date'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;

select lives_ok(
  format(
    $sql$insert into public.utility_reservations
      (profile_id, mode, reservation_date, slot, location, detail, recurring, applicant_name)
      values (0, 'gongang', %L, 'honjeong-end', 'floor_10', '종료 후 새 장기', true, '')$sql$,
    current_setting('test.korea_today')
  ),
  'an ended recurrence no longer blocks a new owner'
);

select lives_ok(
  format(
    $sql$insert into public.utility_reservations
      (profile_id, mode, reservation_date, slot, location, detail, recurring, applicant_name)
      values
        (0, 'gongang', %1$L, 'study-1', 'floor_4', '일회 과거 취소', false, ''),
        (0, 'gongang', %1$L, 'honjeong-end', 'floor_4', '일회 당일 취소', false, ''),
        (0, 'gongang', %1$L, 'study-2', 'floor_4', '일회 미래 취소', false, '')$sql$,
    current_setting('test.korea_today')
  ),
  'an owner can create one-time reservations for cancellation checks'
);
select set_config(
  'test.past_one_time_id',
  (select id::text from public.utility_reservations where detail = '일회 과거 취소'),
  true
);
select set_config(
  'test.current_one_time_id',
  (select id::text from public.utility_reservations where detail = '일회 당일 취소'),
  true
);
select set_config(
  'test.future_one_time_id',
  (select id::text from public.utility_reservations where detail = '일회 미래 취소'),
  true
);

reset role;
update public.utility_reservations
set reservation_date = current_setting('test.korea_today')::date - 1
where id = current_setting('test.past_one_time_id')::bigint;
update public.utility_reservations
set reservation_date = current_setting('test.korea_today')::date + 1
where id = current_setting('test.future_one_time_id')::bigint;
set local role authenticated;

select throws_ok(
  format(
    $sql$select public.cancel_utility_reservation(%s)$sql$,
    current_setting('test.past_one_time_id')
  ),
  '22023',
  'past utility reservations cannot be cancelled',
  'an owner cannot cancel a past one-time reservation'
);
select is(
  (select count(*) from public.utility_reservations where id = current_setting('test.past_one_time_id')::bigint),
  1::bigint,
  'a rejected past cancellation preserves the one-time reservation'
);
select lives_ok(
  format(
    $sql$select public.cancel_utility_reservation(%s)$sql$,
    current_setting('test.current_one_time_id')
  ),
  'an owner can cancel a current one-time reservation'
);
select is(
  (select count(*) from public.utility_reservations where id = current_setting('test.current_one_time_id')::bigint),
  0::bigint,
  'current one-time cancellation deletes the reservation'
);
select lives_ok(
  format(
    $sql$select public.cancel_utility_reservation(%s)$sql$,
    current_setting('test.future_one_time_id')
  ),
  'an owner can cancel a future one-time reservation'
);
select is(
  (select count(*) from public.utility_reservations where id = current_setting('test.future_one_time_id')::bigint),
  0::bigint,
  'future one-time cancellation deletes the reservation'
);

select set_config(
  'test.karaoke_slot',
  case
    when extract(isodow from current_setting('test.korea_today')::date) between 1 and 5
      then 'lunch'
    else 'hour-8'
  end,
  true
);

select lives_ok(
  format(
    $sql$insert into public.utility_reservations
      (profile_id, mode, reservation_date, slot, location, detail, recurring, applicant_name)
      values (0, 'karaoke', %L, %L, 'floor_b1', '노래방 이용자', true, '')$sql$,
    current_setting('test.korea_today'),
    current_setting('test.karaoke_slot')
  ),
  'an accepted user can reserve karaoke in the current Korea week'
);
select is(
  (
    select location is null and recurring = false
    from public.utility_reservations
    where mode = 'karaoke'
  ),
  true,
  'karaoke reservations are always one-time and have no gongang location'
);
select throws_ok(
  format(
    $sql$insert into public.utility_reservations
      (profile_id, mode, reservation_date, slot, location, detail, recurring, applicant_name)
      values (0, 'karaoke', %L::date - 1, %L, null, '지난 노래방', false, '')$sql$,
    current_setting('test.korea_today'),
    current_setting('test.karaoke_slot')
  ),
  '22023',
  'utility reservations are limited to the current Korea week',
  'karaoke rejects dates before today'
);
select throws_ok(
  format(
    $sql$insert into public.utility_reservations
      (profile_id, mode, reservation_date, slot, location, detail, recurring, applicant_name)
      values (0, 'karaoke', %L, %L, null, '차주 노래방', false, '')$sql$,
    current_setting('test.next_occurrence'),
    current_setting('test.karaoke_slot')
  ),
  '22023',
  'utility reservations are limited to the current Korea week',
  'karaoke rejects next-week prebooking'
);

select * from finish();
rollback;
