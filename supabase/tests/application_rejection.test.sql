begin;

create extension if not exists pgtap with schema extensions;
select plan(22);

-- 신청자는 직접 로그인해 반려 사유를 읽어야 하므로 Auth 사용자와 승인 대기 프로필을 새로 만든다.
-- 김관리(…098)가 앱 관리자고, 홍길동(…001)은 관리자가 아닌 승인 회원이다.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000', '21000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'rejection-applicant@kmla.hs.kr', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
insert into public.profiles (
  auth_user_id, name, type, student_number, cohort, status, submitted_at
)
values (
  '21000000-0000-0000-0000-000000000001', '반려 신청자', 'student', '269101', 32,
  'pending', now()
);
-- 반려된 적 없는 비교 대상. 로그인할 일이 없어 Auth 사용자 없이 만든다.
insert into public.profiles (name, type, student_number, cohort, status, submitted_at)
values ('처음 신청자', 'student', '269103', 32, 'pending', now());

select set_config('test.applicant_id', (
  select id::text from public.profiles
  where auth_user_id = '21000000-0000-0000-0000-000000000001'
), true);
select set_config('test.admin_id', (select id::text from public.profiles where pub_id = 'kim-admin'), true);
select set_config('test.accepted_id', (
  select id::text from public.profiles
  where auth_user_id = '10000000-0000-0000-0000-000000000001'
), true);

insert into private.web_push_subscriptions (profile_id, endpoint, p256dh, auth, created_at)
values (
  current_setting('test.applicant_id')::bigint, 'https://push.example.test/application-rejection',
  'BNcRdreALRFXTkA0bP8M5bq6fP6w6uLqFhKxqv2QdA', 'dGVzdC1hdXRoLWtleQ', now() - interval '1 hour'
);

create function pg_temp.act_as(user_id text) returns void
language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', user_id)::text, true);
$$;
grant execute on function pg_temp.act_as(text) to authenticated;

set local role authenticated;

-- 반려 권한과 입력 검증
select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.admin_reject_application(current_setting('test.applicant_id')::bigint, '기수를 확인해 주세요.')$$,
  '42501', 'app administrator required',
  'a non-admin cannot reject an application'
);

select pg_temp.act_as('10000000-0000-0000-0000-000000000098');
select throws_ok(
  $$select * from public.admin_reject_application(current_setting('test.accepted_id')::bigint, '기수를 확인해 주세요.')$$,
  '55000', 'pending application not found',
  'only pending applications can be rejected'
);
select throws_ok(
  $$select * from public.admin_reject_application(current_setting('test.applicant_id')::bigint, '  짧음  ')$$,
  '22023', 'reason must be 5 to 300 characters',
  'a trimmed reason shorter than five characters is rejected'
);
select throws_ok(
  $$select * from public.admin_reject_application(current_setting('test.applicant_id')::bigint, repeat('가', 301))$$,
  '22023', 'reason must be 5 to 300 characters',
  'a reason longer than 300 characters is rejected'
);

select results_eq(
  $$select status from public.admin_reject_application(current_setting('test.applicant_id')::bigint, '  기수와 학번이 맞지 않습니다.  ')$$,
  $$values ('draft'::public.profile_status)$$,
  'rejecting returns the application to draft'
);

reset role;
select results_eq(
  $$select status::text, status_updated_by from public.profiles where id = current_setting('test.applicant_id')::bigint$$,
  $$values ('draft', current_setting('test.admin_id')::bigint)$$,
  'the profile records which admin rejected it'
);
select results_eq(
  $$select reason, rejected_by_profile_id from private.application_rejections
    where profile_id = current_setting('test.applicant_id')::bigint$$,
  $$values ('기수와 학번이 맞지 않습니다.', current_setting('test.admin_id')::bigint)$$,
  'the trimmed reason and the rejecting admin are recorded'
);
select ok(
  not has_table_privilege('authenticated', 'private.application_rejections', 'SELECT')
    and not has_table_privilege('anon', 'private.application_rejections', 'SELECT'),
  'clients cannot read rejection records directly'
);
select ok(
  has_function_privilege('authenticated', 'public.admin_reject_application(bigint, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.admin_reject_application(bigint, text)', 'EXECUTE'),
  'only signed-in users can call the rejection RPC'
);

-- 반려 알림
select results_eq(
  $$select kind::text, title from public.notifications
    where recipient_profile_id = current_setting('test.applicant_id')::bigint
      and kind in ('account_rejected', 'account_unblocked')$$,
  $$values ('account_rejected', '가입 신청이 반려되었습니다.')$$,
  'rejecting sends a rejection notification, not an unblock notification'
);

set local role service_role;
create temp table rejection_delivery as
select * from public.claim_notification_deliveries(200, 60)
where title = '가입 신청이 반려되었습니다.';
reset role;
select results_eq(
  $$select channel::text from rejection_delivery order by channel::text$$,
  $$values ('email'), ('web_push')$$,
  'the rejection goes out by email and Web Push'
);
select ok(
  (select body like '%기수와 학번이 맞지 않습니다.%' and body like '%다시 제출%'
   from rejection_delivery where channel = 'email'),
  'the rejection email carries the reason and resubmission guidance'
);
select ok(
  (select body not like '%기수와 학번이 맞지 않습니다.%' from rejection_delivery where channel = 'web_push'),
  'Web Push leaves the reason off the lock screen'
);

-- 신청자 본인의 반려 사유
select set_config('test.terms_version', private.current_terms_version()::text, true);
set local role authenticated;
select pg_temp.act_as('21000000-0000-0000-0000-000000000001');
select results_eq(
  $$select to_jsonb(rejection) - 'rejected_at' from public.get_my_application_rejection() as rejection$$,
  $$values ('{"reason": "기수와 학번이 맞지 않습니다."}'::jsonb)$$,
  'the applicant reads only the latest reason and time, never the rejecting admin'
);
select pg_temp.act_as('10000000-0000-0000-0000-000000000001');
select is_empty(
  $$select * from public.get_my_application_rejection()$$,
  'another member has no rejection to read'
);

-- 다시 제출하면 안내가 사라진다.
select pg_temp.act_as('21000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.submit_my_profile(
      p_name => '반려 신청자', p_type => 'student', p_student_number => '269101',
      p_cohort => 31::smallint, p_terms_version => current_setting('test.terms_version')::date
    )$$,
  'a rejected applicant can resubmit'
);
select is_empty(
  $$select * from public.get_my_application_rejection()$$,
  'a resubmitted applicant no longer sees the rejection'
);

-- 다시 낸 신청은 관리자에게 이전 반려와 함께 보인다.
select pg_temp.act_as('10000000-0000-0000-0000-000000000098');
select results_eq(
  $$select name, rejection_count, last_rejection_reason
    from public.admin_list_applications('pending')
    where name in ('반려 신청자', '처음 신청자')
    order by name$$,
  $$values
    ('반려 신청자', 1::bigint, '기수와 학번이 맞지 않습니다.'),
    ('처음 신청자', 0::bigint, null::text)$$,
  'pending applications show the rejection count and the latest reason'
);

-- 반려 기록 보존: 승인하면 지우고 차단하면 남긴다.
reset role;
insert into private.application_rejections (profile_id, reason)
select id, '이름을 확인해 주세요.' from public.profiles where name = '처음 신청자';
select set_config('test.pending_id', (select id::text from public.profiles where name = '처음 신청자'), true);
set local role authenticated;
select pg_temp.act_as('10000000-0000-0000-0000-000000000098');
select public.admin_review_applications(array[current_setting('test.applicant_id')::bigint], 'accepted');
select public.admin_review_applications(
  array[current_setting('test.pending_id')::bigint], 'blocked'
);
reset role;
select is_empty(
  $$select 1 from private.application_rejections where profile_id = current_setting('test.applicant_id')::bigint$$,
  'approving an application deletes its rejection records'
);
select isnt_empty(
  $$select 1 from private.application_rejections where profile_id = current_setting('test.pending_id')::bigint$$,
  'blocking an application keeps its rejection records'
);

-- 차단 해제 이메일도 고쳐 다시 제출하라고 안내한다.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000', '21000000-0000-0000-0000-000000000002',
  'authenticated', 'authenticated', 'unblock-applicant@kmla.hs.kr', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
insert into public.profiles (
  auth_user_id, name, type, student_number, cohort, status, submitted_at
)
values (
  '21000000-0000-0000-0000-000000000002', '차단 해제 신청자', 'student', '269102', 32,
  'blocked', now()
);
select set_config('test.unblocked_id', (
  select id::text from public.profiles
  where auth_user_id = '21000000-0000-0000-0000-000000000002'
), true);
set local role authenticated;
select pg_temp.act_as('10000000-0000-0000-0000-000000000098');
select results_eq(
  $$select status from public.admin_unblock_application(current_setting('test.unblocked_id')::bigint)$$,
  $$values ('draft'::public.profile_status)$$,
  'unblocking returns the application to draft'
);
set local role service_role;
create temp table unblock_delivery as
select * from public.claim_notification_deliveries(200, 60)
where channel = 'email' and title = '차단이 해제되었습니다.';
reset role;
select ok(
  (select bool_and(body like '%다시 제출%') from unblock_delivery),
  'the unblock email tells the applicant to fix and resubmit the profile'
);

select * from finish();
rollback;
