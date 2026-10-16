begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

-- 클라이언트 권한 경계
select ok(
  not has_function_privilege('anon', 'public.list_school_notices()', 'EXECUTE'),
  'signed-out visitors cannot list school notices'
);
select ok(
  not has_function_privilege('authenticated', 'public.school_notice_credentials()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.school_notice_credentials()', 'EXECUTE'),
  'clients cannot read the school account'
);
select ok(
  has_function_privilege('service_role', 'public.school_notice_credentials()', 'EXECUTE'),
  'the sync function can read the school account'
);
select ok(
  not has_function_privilege('authenticated', 'public.record_school_notice_sync(jsonb, text)', 'EXECUTE'),
  'clients cannot write school notices'
);
select ok(
  has_function_privilege('service_role', 'public.record_school_notice_sync(jsonb, text)', 'EXECUTE'),
  'the sync function can write school notices'
);
select ok(
  not has_table_privilege('authenticated', 'private.school_notices', 'SELECT'),
  'clients cannot read the notice cache table directly'
);

-- 동기화 결과 기록: service_role
set local role service_role;
select lives_ok(
  $$select public.record_school_notice_sync('[
    {"postId": 5865, "category": "교무", "title": "대강 안내", "author": "가", "postedOn": "2026-10-14", "hasAttachment": true},
    {"postId": 5863, "category": "교무", "title": "입법박람회", "author": "나", "postedOn": "2026-10-12", "hasAttachment": false}
  ]', null)$$,
  'a successful sync stores the notices'
);
select lives_ok(
  $$select public.record_school_notice_sync(null, 'empty_list')$$,
  'a failed sync is recorded'
);
reset role;

select is(
  (select count(*) from private.school_notices), 2::bigint,
  'a failed sync keeps the previous notices'
);

set local role service_role;
select lives_ok(
  $$select public.record_school_notice_sync('[
    {"postId": 5866, "category": "학생", "title": "새 공지", "author": "다", "postedOn": "2026-10-16", "hasAttachment": false},
    {"postId": 5865, "category": "교무", "title": "대강 안내(수정)", "author": "가", "postedOn": "2026-10-14", "hasAttachment": true}
  ]', null)$$,
  'a later sync replaces the list'
);
reset role;

-- 승인 사용자 열람
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000099', true);
set local role authenticated;
select results_eq(
  $$select post_id, category, title, posted_on, has_attachment from public.list_school_notices()$$,
  $$values (5866, '학생', '새 공지', date '2026-10-16', false),
           (5865, '교무', '대강 안내(수정)', date '2026-10-14', true)$$,
  'approved members see the latest list in school order, without notices the school removed'
);
select isnt(
  (select synced_at from public.list_school_notices() limit 1), null,
  'the list carries when it was last synced'
);
select throws_ok(
  $$select public.admin_set_school_notice_account('someone', 'pw')$$,
  '42501', 'app administrator required',
  'a non-admin cannot change the school account'
);
select throws_ok(
  $$select * from public.admin_school_notice_status()$$,
  '42501', 'app administrator required',
  'a non-admin cannot see the sync status'
);
reset role;

-- 가입 승인이 없는 로그인 사용자
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000ff', true);
set local role authenticated;
select is_empty(
  $$select * from public.list_school_notices()$$,
  'a signed-in user without an approved profile sees no notices'
);
reset role;

-- 관리자
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000098', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_set_school_notice_account('  ', 'pw')$$,
  '22023', null,
  'the school id cannot be blank'
);
select lives_ok(
  $$select public.admin_set_school_notice_account(' school-id ', 'first-pw')$$,
  'an app admin can set the school account'
);
select lives_ok(
  $$select public.admin_set_school_notice_account('other-id', 'second-pw')$$,
  'an app admin can replace the school account'
);
select results_eq(
  $$select login_id, account_configured, last_error from public.admin_school_notice_status()$$,
  $$values ('other-id'::text, true, 'empty_list'::text)$$,
  'the status shows the school id and the last failure, never the password'
);
reset role;

set local role service_role;
select results_eq(
  $$select login_id, password from public.school_notice_credentials()$$,
  $$values ('other-id'::text, 'second-pw'::text)$$,
  'the sync function reads the latest account'
);
reset role;

select * from finish();
rollback;
