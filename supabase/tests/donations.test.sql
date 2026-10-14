begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email)
values ('10000000-0000-0000-0000-000000007001', 'donation-admin-test@kmla.hs.kr');
update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000007001'
where pub_id = 'kim-admin';

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000007001', true);
set local role authenticated;
select set_config('test.donation_round', public.donation_create_round('기부 테스트', now() - interval '1 hour', now() + interval '1 hour')::text, true);

select lives_ok(
  $$select public.donation_import_items(current_setting('test.donation_round')::bigint,
    '[{"category":"국내반 교재","name":"원래 교재","detail":null,"donorName":null,"sourceSheet":"domestic","sourceRow":1}]'::jsonb)$$,
  'an administrator imports an Excel item into an empty round'
);
select throws_ok(
  $$select public.donation_import_items(current_setting('test.donation_round')::bigint,
    '[{"category":"국내반 교재","name":"교체 교재","detail":null,"donorName":null,"sourceSheet":"domestic","sourceRow":1}]'::jsonb)$$,
  '55000', 'items already imported',
  're-uploading cannot replace existing items even without applications'
);
select is(
  (select name from public.donation_list_items(current_setting('test.donation_round')::bigint)),
  '원래 교재',
  'the original item is preserved after a rejected re-upload'
);


-- All mutations and reads go through the same RPC boundary as the app.
select set_config('test.donation_item',
  (select id from public.donation_list_items(current_setting('test.donation_round')::bigint))::text, true);
select set_config('test.donation_future',
  public.donation_create_round('다음 회차', now() + interval '2 hours', now() + interval '3 hours')::text, true);
select is(public.donation_import_items(current_setting('test.donation_future')::bigint,
  '[{"category":"생활용품","name":"다음 회차 물품","detail":null,"donorName":null,"sourceSheet":"daily","sourceRow":1}]'),
  1, 'another round receives its own independent inventory');
select set_config('test.donation_future_item',
  (select id from public.donation_list_items(current_setting('test.donation_future')::bigint))::text, true);

select throws_ok(
  $$select public.donation_create_round('겹침', now(), now() + interval '2 hours')$$,
  '22023', 'donation rounds cannot overlap', 'overlapping periods are rejected');
select throws_ok(
  $$select public.donation_update_round(current_setting('test.donation_future')::bigint, '겹침', now(), now() + interval '2 hours')$$,
  '22023', 'donation rounds cannot overlap', 'editing cannot overlap another period');
select throws_ok(
  $$select public.donation_create_round('역순', now(), now() - interval '1 hour')$$,
  '22023', 'invalid donation round', 'a period must end after it starts');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select is((select id from public.donation_list_rounds()), current_setting('test.donation_round')::bigint,
  'users see the active round even when a newer future round exists');
select is((select count(*) from public.donation_list_items(current_setting('test.donation_future')::bigint)),
  0::bigint, 'users cannot read future inventory');
select throws_ok(
  $$select public.donation_claim_item(current_setting('test.donation_future_item')::bigint)$$,
  '22023', 'applications are closed', 'users cannot apply before the start');
select throws_ok(
  $$select public.donation_create_round('학생 생성', now() + interval '5 hours', now() + interval '6 hours')$$,
  '42501', 'app administrator required', 'only administrators create rounds');
select throws_ok(
  $$select public.donation_import_items(current_setting('test.donation_future')::bigint, '[]')$$,
  '42501', 'app administrator required', 'only administrators import inventory');
select throws_ok(
  $$select public.donation_update_round(current_setting('test.donation_round')::bigint, '학생 수정', now(), now() + interval '1 hour')$$,
  '42501', 'app administrator required', 'only administrators edit periods');
select throws_ok(
  $$select * from public.donation_list_claims(current_setting('test.donation_round')::bigint)$$,
  '42501', 'app administrator required', 'only administrators read application history');
select lives_ok(
  $$select public.donation_claim_item(current_setting('test.donation_item')::bigint)$$,
  'an accepted user can claim an available item');
select ok((select is_mine from public.donation_list_items(current_setting('test.donation_round')::bigint)),
  'the applicant sees their own claim');
select throws_ok(
  $$select public.donation_claim_item(current_setting('test.donation_item')::bigint)$$,
  '23505', 'item already claimed', 'duplicate applications are rejected');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
select ok((select is_claimed and not is_mine from public.donation_list_items(current_setting('test.donation_round')::bigint)),
  'another user sees the item is taken');
select throws_ok(
  $$select public.donation_claim_item(current_setting('test.donation_item')::bigint)$$,
  '23505', 'item already claimed', 'two users cannot hold the same item');
select throws_ok(
  $$select public.donation_cancel_claim(current_setting('test.donation_item')::bigint)$$,
  '22023', 'active application not found or period closed', 'users cannot cancel another user claim');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.donation_cancel_claim(current_setting('test.donation_item')::bigint)$$,
  'the applicant can cancel during the application period');
select ok((select not is_claimed from public.donation_list_items(current_setting('test.donation_round')::bigint)),
  'cancellation makes the item available again');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
select lives_ok(
  $$select public.donation_claim_item(current_setting('test.donation_item')::bigint)$$,
  'another user can claim a cancelled item');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000007001', true);
select is((select count(*) from public.donation_list_claims(current_setting('test.donation_round')::bigint)),
  2::bigint, 'the administrator retains both application records');
select is((select count(*) from public.donation_list_claims(current_setting('test.donation_round')::bigint) where cancelled_at is not null),
  1::bigint, 'the cancelled application remains in history');
select is((select count(*) from public.donation_list_claims(current_setting('test.donation_round')::bigint) where applied_at is not null and cancelled_at is null),
  1::bigint, 'only one application is active');
select lives_ok(
  $$select public.donation_update_round(current_setting('test.donation_round')::bigint, '종료된 회차', now() - interval '1 hour', now())$$,
  'an administrator can adjust a period without losing application history');
select lives_ok(
  $$select public.donation_update_round(current_setting('test.donation_future')::bigint, '새 회차', now(), now() + interval '1 hour')$$,
  'adjacent periods may share an end/start boundary');
select is((select count(*) from public.donation_list_items(current_setting('test.donation_round')::bigint)),
  1::bigint, 'administrators can read ended inventory');
select is((select count(*) from public.donation_list_claims(current_setting('test.donation_round')::bigint)),
  2::bigint, 'ending a round preserves all application history');
select throws_ok(
  $$select public.donation_import_items(current_setting('test.donation_round')::bigint, '[]')$$,
  '22023', 'round not found or closed', 'ended rounds cannot be imported');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
select is((select id from public.donation_list_rounds()), current_setting('test.donation_future')::bigint,
  'the next round is the only user-visible round when it opens');
select is((select name from public.donation_list_items(current_setting('test.donation_future')::bigint)),
  '다음 회차 물품', 'the new round exposes only its own items');
select is((select count(*) from public.donation_list_items(current_setting('test.donation_round')::bigint)),
  0::bigint, 'ended inventory is hidden from users');
select is((select count(*) from public.donation_list_claimed_by(current_setting('test.donation_round')::bigint)),
  0::bigint, 'ended applicant information is hidden from users');
select throws_ok(
  $$select public.donation_cancel_claim(current_setting('test.donation_item')::bigint)$$,
  '22023', 'active application not found or period closed', 'cancellation closes at the exact end time');
select throws_ok(
  $$select public.donation_claim_item(current_setting('test.donation_item')::bigint)$$,
  '22023', 'applications are closed', 'applications close at the exact end time');
select lives_ok(
  $$select public.donation_claim_item(current_setting('test.donation_future_item')::bigint)$$,
  'applications open at the exact start time');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000007001', true);
select set_config('test.donation_limit',
  public.donation_create_round('신청 한도', now() + interval '10 hours', now() + interval '11 hours')::text, true);
select is(public.donation_import_items(current_setting('test.donation_limit')::bigint,
  (select jsonb_agg(jsonb_build_object('category', '생활용품', 'name', '한도 물품 ' || n,
    'sourceSheet', 'daily', 'sourceRow', n)) from generate_series(1, 51) as n)),
  51, 'an administrator imports more items than one user may claim');
select lives_ok(
  $$select public.donation_update_round(current_setting('test.donation_future')::bigint, '새 회차', now() + interval '20 hours', now() + interval '21 hours')$$,
  'a round with applications can be moved later');
select lives_ok(
  $$select public.donation_update_round(current_setting('test.donation_limit')::bigint, '신청 한도', now(), now() + interval '1 hour')$$,
  'the limit round opens now');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
select ok((select is_open from public.donation_list_rounds() where id = current_setting('test.donation_limit')::bigint),
  'the round list reports the server-side open state');
select is((select count(*)::integer from public.donation_list_items(current_setting('test.donation_limit')::bigint) as item,
  lateral (select public.donation_claim_item(item.id)) as claimed
  where item.name <> '한도 물품 51'),
  50, 'a user can hold 50 active claims in one round');
select throws_ok(
  $$select public.donation_claim_item((select id from public.donation_list_items(current_setting('test.donation_limit')::bigint) where name = '한도 물품 51'))$$,
  '22023', 'application limit reached', 'the 51st active claim in a round is rejected');
select lives_ok(
  $$select public.donation_cancel_claim((select id from public.donation_list_items(current_setting('test.donation_limit')::bigint) where name = '한도 물품 1'))$$,
  'cancelling frees one claim slot');
select lives_ok(
  $$select public.donation_claim_item((select id from public.donation_list_items(current_setting('test.donation_limit')::bigint) where name = '한도 물품 51'))$$,
  'a freed slot can be used again');

select set_config('test.donation_free_item',
  (select id from public.donation_list_items(current_setting('test.donation_limit')::bigint) where name = '한도 물품 1')::text, true);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000099', true);
select throws_ok(
  $$select public.donation_claim_item(current_setting('test.donation_free_item')::bigint)$$,
  '42501', 'only students can apply', 'teachers cannot apply');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000007001', true);
select throws_ok(
  $$select public.donation_claim_item(current_setting('test.donation_free_item')::bigint)$$,
  '42501', 'only students can apply', 'administrator rights alone do not allow applying');

reset role;
update public.profiles set role = 'admin'
where auth_user_id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.donation_claim_item(current_setting('test.donation_free_item')::bigint)$$,
  'an administrator who is a current student can apply');
select lives_ok(
  $$select public.donation_cancel_claim(current_setting('test.donation_free_item')::bigint)$$,
  'the student administrator releases the item again');

reset role;
update public.profiles set type = 'alumni'
where auth_user_id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok(
  $$select public.donation_claim_item(current_setting('test.donation_free_item')::bigint)$$,
  '42501', 'only students can apply', 'alumni cannot apply');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000007001', true);
select set_config('test.donation_invalid',
  public.donation_create_round('업로드 검증', now() + interval '5 hours', now() + interval '6 hours')::text, true);
select throws_ok(
  $$select public.donation_import_items(current_setting('test.donation_invalid')::bigint,
  '[{"category":"생활용품","name":"정상 물품","sourceSheet":"daily","sourceRow":1},
    {"category":"생활용품","name":"","sourceSheet":"daily","sourceRow":2}]')$$,
  '22023', 'invalid donation item at upload row 2', 'one invalid row rejects the whole upload');
select is((select count(*) from public.donation_list_items(current_setting('test.donation_invalid')::bigint)),
  0::bigint, 'a failed upload leaves no partial inventory');
select ok(to_regprocedure('public.donation_delete_round(bigint)') is null,
  'there is no client round-deletion endpoint');
reset role;
select ok(not has_table_privilege('authenticated', 'public.donation_rounds', 'SELECT,INSERT,UPDATE,DELETE'),
  'rounds have no direct browser table access');
select ok(not has_table_privilege('authenticated', 'public.donation_items', 'SELECT,INSERT,UPDATE,DELETE'),
  'items have no direct browser table access');
select ok(not has_table_privilege('authenticated', 'public.donation_claims', 'SELECT,INSERT,UPDATE,DELETE'),
  'claims have no direct browser table access');
select ok(not has_sequence_privilege('authenticated', 'public.donation_items_id_seq', 'USAGE,UPDATE'),
  'browser users cannot advance item identifiers');
select ok(not has_function_privilege('anon', 'public.donation_list_rounds()', 'EXECUTE'),
  'anonymous users cannot read donation rounds');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.donation_rounds'::regclass, 'public.donation_items'::regclass, 'public.donation_claims'::regclass)),
  'all donation tables have RLS enabled');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000007002', true);
set local role authenticated;
select throws_ok($$select * from public.donation_list_rounds()$$,
  '42501', 'accepted profile required', 'accounts without an accepted profile cannot access donations');
select throws_ok($$select public.donation_claim_item(current_setting('test.donation_future_item')::bigint)$$,
  '42501', 'accepted profile required', 'accounts without an accepted profile cannot apply');
select * from finish();
rollback;
