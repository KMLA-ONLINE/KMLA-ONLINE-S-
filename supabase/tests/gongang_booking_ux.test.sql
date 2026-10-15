begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_function_privilege('anon', 'public.save_gongang_schedule(jsonb)', 'execute')
 and not has_function_privilege('service_role', 'public.save_gongang_schedule(jsonb)', 'execute')
 and has_function_privilege('authenticated', 'public.save_gongang_schedule(jsonb)', 'execute'),
 'only signed-in users can call the prebooking batch; it authorizes them itself');
select ok(not has_function_privilege('anon', 'private.can_manage_gongang()', 'execute')
 and not has_function_privilege('service_role', 'private.can_manage_gongang()', 'execute'),
 'the manager check is not exposed beyond signed-in users');
insert into auth.users (id, email) values
 ('20000000-0000-0000-0000-000000007001', 'gongang-ux-admin@kmla.hs.kr'),
 ('20000000-0000-0000-0000-000000007002', 'gongang-ux-user@kmla.hs.kr');
update public.profiles set auth_user_id = '20000000-0000-0000-0000-000000007001' where pub_id = 'kim-admin';
update public.profiles set auth_user_id = '20000000-0000-0000-0000-000000007002' where pub_id = 'hanbyeol-25';
select set_config('test.gongang_today', ((now() at time zone 'Asia/Seoul')::date)::text, true);
select set_config('test.gongang_next_monday', ((now() at time zone 'Asia/Seoul')::date + (8 - extract(isodow from (now() at time zone 'Asia/Seoul')::date)::integer))::text, true);
select set_config('test.gongang_next_same_day', ((now() at time zone 'Asia/Seoul')::date + 7)::text, true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000007002', true);
select throws_ok($$select public.save_gongang_schedule('[]')$$, '42501', 'gongang manager permission required', 'ordinary users cannot configure prebookings');
select throws_ok(format($sql$insert into public.utility_reservations(profile_id,mode,reservation_date,slot,location,detail,applicant_name) values
 (0,'gongang',%L,'study-2','floor_b1','atomic-user',''),
 (0,'gongang',%L,'invalid-slot','floor_2','atomic-user','')$sql$,current_setting('test.gongang_today'),current_setting('test.gongang_today')),
 '23514', null, 'one invalid selection rejects the whole insert');
select is((select count(*) from public.utility_reservations where detail='atomic-user'), 0::bigint, 'bulk rejection leaves no partial reservation');
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000007001', true);
select ok(private.can_manage_gongang(), 'an app administrator can manage without a separate permission grant');
select lives_ok(format($sql$select public.save_gongang_schedule(jsonb_build_array(
 jsonb_build_object('schedule_date',%L,'slot','lunch','location','floor_b1','reserved',true,'detail','점심 정기','recurring',true),
 jsonb_build_object('schedule_date',%L,'slot','dinner','location','floor_2','reserved',true,'detail','저녁 정기','recurring',true)))$sql$,current_setting('test.gongang_next_monday'),current_setting('test.gongang_next_monday')),
 'an app admin prebooks weekday lunch and dinner in one batch');
select is((select count(*) from public.gongang_schedule where recurring and slot in ('lunch','dinner')), 2::bigint, 'both meal slots retain the recurring flag');
select throws_ok(format($sql$select public.save_gongang_schedule(jsonb_build_array(
 jsonb_build_object('schedule_date',%L,'slot','study-1','location','floor_b1','reserved',true,'detail','atomic-manager','recurring',false),
 jsonb_build_object('schedule_date',%L,'slot','invalid-slot','location','floor_2','reserved',true,'detail','atomic-manager','recurring',false)))$sql$,current_setting('test.gongang_next_monday'),current_setting('test.gongang_next_monday')),
 '23514', null, 'one invalid prebooking rejects the whole batch');
select is((select count(*) from public.gongang_schedule where detail='atomic-manager'),0::bigint,'rejected prebooking leaves no partial schedule');
select lives_ok(format($sql$select public.save_gongang_schedule(jsonb_build_array(jsonb_build_object('schedule_date',%L,'slot','study-2','location','floor_10','reserved',true,'detail','반복 점유','recurring',true)))$sql$,current_setting('test.gongang_next_same_day')),
 'a repeat can start on any day of next week');
reset role;
-- Simulate a repeat created in an earlier week without changing the wall clock.
alter table public.gongang_schedule disable trigger gongang_schedule_prepare;
update public.gongang_schedule set schedule_date=current_setting('test.gongang_today')::date - 7 where detail='반복 점유';
alter table public.gongang_schedule enable trigger gongang_schedule_prepare;
set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000007002', true);
select throws_ok(format($sql$insert into public.utility_reservations(profile_id,mode,reservation_date,slot,location,detail,applicant_name,recurring)
 values(0,'gongang',%L,'study-2','floor_10','차단 확인','',false)$sql$,current_setting('test.gongang_today')),
 '23505', 'reserved by gongang manager', 'a past-start manager repeat blocks this week');
select throws_ok(format($sql$insert into public.utility_reservations(profile_id,mode,reservation_date,slot,location,detail,applicant_name,recurring)
 values(0,'gongang',%L,'study-2','floor_10','빈 반복 방지','',true)$sql$,current_setting('test.gongang_today')),
 '23505', 'reserved by gongang manager', 'a manager repeat also blocks a zero-length user repeat');
select lives_ok(format($sql$insert into public.utility_reservations(profile_id,mode,reservation_date,slot,location,detail,applicant_name,recurring)
 values(0,'gongang',%L,'study-1','floor_4','기존 학생 반복','',true)$sql$,current_setting('test.gongang_today')), 'a user creates an available repeat');
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000007001', true);
select lives_ok(format($sql$select public.save_gongang_schedule(jsonb_build_array(jsonb_build_object('schedule_date',%L,'slot','study-1','location','floor_4','reserved',true,'detail','관리자 반복','recurring',true)))$sql$,current_setting('test.gongang_next_same_day')), 'a manager repeat preempts an existing student repeat');
select is((select recurring_until from public.utility_reservations where detail='기존 학생 반복'), current_setting('test.gongang_next_same_day')::date, 'the preempted student repeat ends at the first manager date');
select lives_ok(format($sql$select public.save_gongang_schedule(jsonb_build_array(jsonb_build_object('schedule_date',%L,'slot','study-2','location','floor_10','reserved',false,'recurring',false)))$sql$,current_setting('test.gongang_next_same_day')),
 'an older manager repeat can end from its next-week occurrence');
select is((select recurring_until from public.gongang_schedule where detail='반복 점유'),current_setting('test.gongang_next_same_day')::date,'ending a repeat preserves its original row and earlier occurrences');
select is((select count(*) from public.gongang_schedule where detail='반복 점유'),1::bigint,'ending a repeat does not delete history');
select throws_ok(format($sql$select public.save_gongang_schedule(jsonb_build_array(jsonb_build_object('schedule_date',%L,'slot','study-1','location','floor_10','reserved',true,'detail','기간 밖','recurring',true)))$sql$,current_setting('test.gongang_today')),
 '22023','only next week can be configured','admin prebookings keep the next-week boundary');
reset role;
select ok(not has_function_privilege('anon','public.save_gongang_schedule(jsonb)','EXECUTE'), 'anonymous callers cannot save prebookings');
select * from finish();
rollback;
