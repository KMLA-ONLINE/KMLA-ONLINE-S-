begin;

create extension if not exists pgtap with schema extensions;
select plan(38);

-- 홍길동(…001)을 정지 대상으로, 김관리(…098)를 앱 관리자로 쓴다.
select set_config('test.target_id', (select id::text from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001'), true);
select set_config('test.admin_id', (select id::text from public.profiles where pub_id = 'kim-admin'), true);
select set_config('test.pending_id', (select id::text from public.profiles where pub_id = 'pending-user'), true);
select set_config('test.other_admin_id', (select id::text from public.profiles where pub_id = 'hanbyeol-25'), true);
update public.profiles set role = 'admin' where pub_id = 'hanbyeol-25';

create function pg_temp.act_as_admin(password_age interval) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '10000000-0000-0000-0000-000000000098',
      'amr', jsonb_build_array(jsonb_build_object(
        'method', 'password', 'timestamp', extract(epoch from now() - password_age)
      ))
    )::text,
    true
  );
$$;
grant execute on function pg_temp.act_as_admin(interval) to authenticated;

-- 정지된 사용자에게 막혔는지: 권한 오류로 거부되거나 아무것도 돌려받지 못하면 막힌 것이다.
create function pg_temp.denied(statement text) returns boolean
language plpgsql as $$
declare
  row_count bigint;
begin
  execute format('select count(*) from (%s) as result', statement) into row_count;
  return row_count = 0;
exception when insufficient_privilege then
  return true;
end;
$$;
grant execute on function pg_temp.denied(text) to authenticated;

-- 권한
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000100"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.admin_suspend_profile(current_setting('test.target_id')::bigint, '분탕 행위 확인', 7)$$,
  '42501', 'app administrator required',
  'a non-admin cannot suspend'
);
select pg_temp.act_as_admin(interval '6 minutes');
select throws_ok(
  $$select * from public.admin_suspend_profile(current_setting('test.target_id')::bigint, '분탕 행위 확인', 7)$$,
  '42501', 'recent password authentication required',
  'suspension requires recent password authentication'
);

-- 대상과 입력 검증
select pg_temp.act_as_admin(interval '0 minutes');
select throws_ok(
  $$select * from public.admin_suspend_profile(current_setting('test.admin_id')::bigint, '분탕 행위 확인', 7)$$,
  '22023', 'app administrators cannot be suspended',
  'an admin cannot suspend themself'
);
select throws_ok(
  $$select * from public.admin_suspend_profile(current_setting('test.other_admin_id')::bigint, '분탕 행위 확인', 7)$$,
  '22023', 'app administrators cannot be suspended',
  'an admin cannot suspend another app admin'
);
select throws_ok(
  $$select * from public.admin_suspend_profile(current_setting('test.pending_id')::bigint, '분탕 행위 확인', 7)$$,
  '22023', 'accepted profile required',
  'only accepted profiles can be suspended'
);
select throws_ok(
  $$select * from public.admin_suspend_profile(current_setting('test.target_id')::bigint, '  짧음  ', 7)$$,
  '22023', 'reason must be 5 to 300 characters',
  'a trimmed reason shorter than five characters is rejected'
);
select throws_ok(
  $$select * from public.admin_suspend_profile(current_setting('test.target_id')::bigint, '분탕 행위 확인', 181)$$,
  '22023', 'days must be between 1 and 180',
  'a period longer than 180 days is rejected'
);
select throws_ok(
  $$select * from public.admin_suspend_profile(current_setting('test.target_id')::bigint, '분탕 행위 확인', 0)$$,
  '22023', 'days must be between 1 and 180',
  'a zero-day period is rejected'
);

-- 적용
select is(
  (select expires_at from public.admin_suspend_profile(current_setting('test.target_id')::bigint, '  분탕 행위 확인  ', 7)),
  now() + interval '7 days',
  'suspension ends the given number of days after it is applied'
);
select throws_ok(
  $$select * from public.admin_suspend_profile(current_setting('test.target_id')::bigint, '다시 정지 시도', 3)$$,
  '55000', 'profile is already suspended',
  'an active suspension cannot be applied again'
);
select results_eq(
  $$select is_suspended, suspension_expires_at from public.admin_list_roster()
    where profile_id = current_setting('test.target_id')::bigint$$,
  $$values (true, now() + interval '7 days')$$,
  'the roster shows an active suspension and its end time'
);
select results_eq(
  $$select is_suspended, suspension_expires_at from public.admin_list_roster()
    where pub_id = 'kim-admin'$$,
  $$values (false, null::timestamptz)$$,
  'the roster shows unsuspended members as such'
);

-- 정지 기간에는 일반 알림을 만들지 않는다. 공강 관리 권한 부여는 대상에게 알림을 만드는 생산자다.
select lives_ok(
  $$select * from public.admin_set_gongang_manager(current_setting('test.target_id')::bigint, true)$$,
  'an admin can still change permissions of a suspended member'
);
reset role;
select is(
  (select count(*) from public.notifications
   where recipient_profile_id = current_setting('test.target_id')::bigint
     and kind = 'gongang_manager_granted'),
  0::bigint,
  'a suspended member receives no ordinary notifications'
);

-- 정지 사실은 알림 행 없이 가입 이메일로만 알린다.
select results_eq(
  $$select title, body like '%사유: 분탕 행위 확인%' and body like '%(한국 시간)%'
    from public.claim_notification_deliveries(200, 120)
    where recipient_email = 'student@kmla.hs.kr'$$,
  $$values ('이용이 정지되었습니다.'::text, true)$$,
  'suspension sends one email with the reason and end time'
);
select pg_temp.act_as_admin(interval '0 minutes');
set local role authenticated;

-- 정지된 사용자의 시점
reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001"}', true);
set local role authenticated;
select is(
  private.current_profile_id(),
  null,
  'a suspended user has no current profile'
);
select is(
  (select status from public.get_my_profile()),
  'accepted'::public.profile_status,
  'a suspended user keeps the accepted status'
);
select results_eq(
  $$select reason, expires_at from public.get_my_suspension()$$,
  $$values ('분탕 행위 확인'::text, now() + interval '7 days')$$,
  'a suspended user can read their own reason and end time'
);

-- `current_profile_id()`를 거치지 않고 본인을 직접 찾는 경로도 막힌다.
select ok(pg_temp.denied($$select * from public.get_accepted_profile('kim-admin')$$),
  'a suspended user cannot read profiles');
select ok(pg_temp.denied($$select * from public.list_birthdays('2026-01-01', 'today')$$),
  'a suspended user cannot list birthdays');
select ok(pg_temp.denied($$select * from public.search_directory('김관리')$$),
  'a suspended user cannot search the directory');
select ok(pg_temp.denied($$select * from public.discover_groups('')$$),
  'a suspended user cannot discover groups');
select ok(pg_temp.denied($$select * from public.list_feed_posts()$$),
  'a suspended user cannot read the feed');
select ok(pg_temp.denied($$select * from public.update_my_profile('홍길동')$$),
  'a suspended user cannot edit their profile');
select ok(pg_temp.denied($$select * from public.create_group('unofficial', '정지 중 만든 그룹')$$),
  'a suspended user cannot create a group');
select ok(pg_temp.denied($$select * from public.prepare_profile_media('avatar', 1000, 100, 100)$$),
  'a suspended user cannot upload profile media');

-- 다른 사용자는 정지를 볼 수 없다
reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000100"}', true);
set local role authenticated;
select is(
  (select count(*) from public.get_my_suspension()),
  0::bigint,
  'an unsuspended user has no suspension'
);
select ok(
  not has_table_privilege('authenticated', 'private.profile_suspensions', 'SELECT'),
  'clients cannot read suspension records directly'
);

-- 해제
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000100"}', true);
select throws_ok(
  $$select * from public.admin_lift_suspension(current_setting('test.target_id')::bigint)$$,
  '42501', 'app administrator required',
  'a non-admin cannot lift a suspension'
);
select pg_temp.act_as_admin(interval '0 minutes');
select lives_ok(
  $$select * from public.admin_lift_suspension(current_setting('test.target_id')::bigint)$$,
  'an admin can lift an active suspension'
);
reset role;
select results_eq(
  $$select title, body from public.claim_notification_deliveries(200, 120)
    where recipient_email = 'student@kmla.hs.kr'$$,
  $$values ('이용 정지가 해제되었습니다.'::text, '다시 KMLA Online을 이용할 수 있습니다.'::text)$$,
  'lifting sends one email'
);
select ok(
  not exists (
    select 1 from public.notifications
    where recipient_profile_id = current_setting('test.target_id')::bigint
      and created_at >= now() - interval '1 minute'
  ),
  'suspension and lifting create no in-app notification'
);
set local role authenticated;
select throws_ok(
  $$select * from public.admin_lift_suspension(current_setting('test.target_id')::bigint)$$,
  '55000', 'profile is not suspended',
  'lifting without an active suspension fails'
);
reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001"}', true);
set local role authenticated;
select is(
  private.current_profile_id(),
  current_setting('test.target_id')::bigint,
  'a lifted suspension restores the current profile'
);

-- 무기한 정지와 만료
select pg_temp.act_as_admin(interval '0 minutes');
select is(
  (select expires_at from public.admin_suspend_profile(current_setting('test.target_id')::bigint, '무기한 정지 사유', null)),
  null,
  'a null period suspends indefinitely'
);

-- 기간이 지난 정지는 따로 처리하지 않아도 풀린다.
reset role;
update private.profile_suspensions
set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
where profile_id = current_setting('test.target_id')::bigint and ended_at is null;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001"}', true);
set local role authenticated;
select is(
  private.current_profile_id(),
  current_setting('test.target_id')::bigint,
  'an expired suspension no longer blocks the user'
);
select is(
  (select count(*) from public.get_my_suspension()),
  0::bigint,
  'an expired suspension is not reported to the user'
);
select pg_temp.act_as_admin(interval '0 minutes');
select lives_ok(
  $$select * from public.admin_suspend_profile(current_setting('test.target_id')::bigint, '만료 뒤 다시 정지', 3)$$,
  'an expired suspension does not prevent a new one'
);

select * from finish();
rollback;
