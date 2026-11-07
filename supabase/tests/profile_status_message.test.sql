begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

-- 상태 메시지(기능 명세 §12.2). 프로필 한 줄 문구로, 프로필 화면과 1:1 대화 정보가 보여 준다.
-- seed: 홍길동(…0001)과 김민준(…0100)은 1:1 대화 c…01에 있다.

-- 클라이언트 역할은 profiles를 직접 읽지 못하므로 홍길동의 공개 ID를 미리 적어 둔다.
select set_config(
  'test.hong_pub_id',
  (select pub_id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001'),
  true
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select public.update_my_profile(
      p_name => '홍길동',
      p_cohort => 29::smallint,
      p_status_message => '  시험 끝! 🎉  '
    )$$,
  'a member can set a status message'
);

select is(
  (select status_message from public.get_my_profile()),
  '시험 끝! 🎉',
  'the status message is stored trimmed'
);

select throws_ok(
  $$select public.update_my_profile(
      p_name => '홍길동',
      p_cohort => 29::smallint,
      p_status_message => repeat('가', 61)
    )$$,
  '22001',
  'status message must be at most 60 characters',
  'a status message longer than 60 characters is rejected'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;

select is(
  (select status_message from public.get_accepted_profile(current_setting('test.hong_pub_id'))),
  '시험 끝! 🎉',
  'another member reads the status message on the profile'
);

select is(
  (
    select participant ->> 'status_message'
    from public.list_conversations('c0000000-0000-0000-0000-000000000001'),
      jsonb_array_elements(participants) as participant
    where (participant ->> 'name') = '홍길동'
  ),
  '시험 끝! 🎉',
  'the chat details get the counterpart status message from the participants'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select public.update_my_profile(
      p_name => '홍길동',
      p_cohort => 29::smallint,
      p_status_message => '   '
    )$$,
  'a blank status message clears it'
);

select is(
  (select status_message from public.get_my_profile()),
  null,
  'the cleared status message is null'
);

select * from finish();
rollback;
