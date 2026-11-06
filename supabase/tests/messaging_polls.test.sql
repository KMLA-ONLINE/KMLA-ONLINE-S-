begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

-- 채팅 투표(기능 명세 §13.30). 그룹 대화에서만 만들고, 멤버가 고르고, 작성자가 종료한다.
-- seed: 홍길동(…0001)과 김민준(…0100)은 그룹 대화 c…02와 1:1 대화 c…01에 있다.

select ok(
  not has_function_privilege('anon', 'public.create_message_poll(uuid,uuid,text,text[],boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.vote_message_poll(uuid,uuid[])', 'EXECUTE')
    and not has_function_privilege('anon', 'public.close_message_poll(uuid)', 'EXECUTE'),
  'anonymous users cannot touch polls'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$select public.create_message_poll(
      'c0000000-0000-0000-0000-000000000001', gen_random_uuid(),
      '점심 뭐 먹지?', array['김밥', '라면'], false)$$,
  '42501',
  'group member required',
  'a direct chat cannot hold a poll'
);

select throws_ok(
  $$select public.create_message_poll(
      'c0000000-0000-0000-0000-000000000002', gen_random_uuid(),
      '점심 뭐 먹지?', array['김밥'], false)$$,
  '22023',
  'poll needs 2 to 10 options',
  'a poll needs at least two options'
);

select throws_ok(
  $$select public.create_message_poll(
      'c0000000-0000-0000-0000-000000000002', gen_random_uuid(),
      '점심 뭐 먹지?', array['김밥', '김밥 '], false)$$,
  '22023',
  'poll options must be distinct',
  'duplicate options are rejected'
);

select throws_ok(
  $$select public.create_message_poll(
      'c0000000-0000-0000-0000-000000000002', gen_random_uuid(),
      repeat('가', 201), array['김밥', '라면'], false)$$,
  '22023',
  'poll question must be 1 to 200 characters',
  'the question has a length limit'
);

select lives_ok(
  $$select set_config('test.poll_id', id::text, true)
    from public.create_message_poll(
      'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000aa01',
      '  점심 뭐 먹지?  ', array[' 김밥 ', '라면', '돈까스'], false)$$,
  'a group member creates a poll'
);

select is(
  current_setting('test.poll_id')::uuid,
  'd0000000-0000-0000-0000-00000000aa01'::uuid,
  'the poll is the message the client named'
);

create temp table poll_row as
select body, poll
from public.list_messages('c0000000-0000-0000-0000-000000000002')
where id = 'd0000000-0000-0000-0000-00000000aa01';

select is(
  (select body from poll_row),
  '점심 뭐 먹지?',
  'the question is the message body, trimmed'
);

select is(
  (select array_agg(option ->> 'label' order by (option ->> 'position')::int)
   from poll_row, jsonb_array_elements(poll -> 'options') as option),
  array['김밥', '라면', '돈까스'],
  'the options come back decrypted, trimmed and in order'
);

select is(
  (select (poll ->> 'multiple')::boolean from poll_row),
  false,
  'a single-choice poll says so'
);

select is(
  (select last_message_poll from public.list_conversations('c0000000-0000-0000-0000-000000000002')),
  true,
  'the list preview knows the last message is a poll'
);

select throws_ok(
  $$select public.edit_message('d0000000-0000-0000-0000-00000000aa01', '다른 질문')$$,
  '55000',
  'poll messages cannot be edited',
  'a poll cannot be edited'
);

select is(
  jsonb_array_length(
    public.search_messages('c0000000-0000-0000-0000-000000000002', '점심') -> 'results'
  ),
  0,
  'poll questions are not searchable'
);

-- 김민준이 투표한다.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;

select set_config(
  'test.option_ids',
  (select string_agg(option ->> 'id', ',' order by (option ->> 'position')::int)
   from public.list_messages('c0000000-0000-0000-0000-000000000002') as message,
     jsonb_array_elements(message.poll -> 'options') as option
   where message.id = 'd0000000-0000-0000-0000-00000000aa01'),
  true
);

select lives_ok(
  $$select public.vote_message_poll(
      'd0000000-0000-0000-0000-00000000aa01',
      array[(string_to_array(current_setting('test.option_ids'), ','))[1]::uuid])$$,
  'a member votes for one option'
);

select throws_ok(
  $$select public.vote_message_poll(
      'd0000000-0000-0000-0000-00000000aa01',
      array[(string_to_array(current_setting('test.option_ids'), ','))[1]::uuid,
            (string_to_array(current_setting('test.option_ids'), ','))[2]::uuid])$$,
  '22023',
  'poll allows one option',
  'a single-choice poll takes only one option'
);

select lives_ok(
  $$select public.vote_message_poll(
      'd0000000-0000-0000-0000-00000000aa01',
      array[(string_to_array(current_setting('test.option_ids'), ','))[2]::uuid])$$,
  'voting again replaces the earlier choice'
);

select is(
  (select array_agg((option ->> 'count')::int order by (option ->> 'position')::int)
   from public.list_messages('c0000000-0000-0000-0000-000000000002') as message,
     jsonb_array_elements(message.poll -> 'options') as option
   where message.id = 'd0000000-0000-0000-0000-00000000aa01'),
  array[0, 1, 0],
  'only the latest choice counts'
);

select throws_ok(
  $$select public.close_message_poll('d0000000-0000-0000-0000-00000000aa01')$$,
  '42501',
  'poll author required',
  'only the author closes the poll'
);

-- 홍길동(작성자)이 종료한다.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select public.close_message_poll('d0000000-0000-0000-0000-00000000aa01')$$,
  'the author closes the poll'
);

select throws_ok(
  $$select public.vote_message_poll(
      'd0000000-0000-0000-0000-00000000aa01',
      array[(string_to_array(current_setting('test.option_ids'), ','))[3]::uuid])$$,
  '55000',
  'poll closed',
  'nobody votes after the poll is closed'
);

select lives_ok(
  $$select * from public.send_message(
      'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000aa02',
      '라면 콜', 'd0000000-0000-0000-0000-00000000aa01')$$,
  'a reply to the poll is sent'
);

select is(
  (select reply_body from public.list_messages('c0000000-0000-0000-0000-000000000002')
   where id = 'd0000000-0000-0000-0000-00000000aa02'),
  '투표: 점심 뭐 먹지?',
  'the reply quote names the poll'
);

select lives_ok(
  $$select public.delete_messages(array['d0000000-0000-0000-0000-00000000aa01'::uuid])$$,
  'the author deletes the poll message'
);

select is(
  (select poll from public.list_messages('c0000000-0000-0000-0000-000000000002')
   where id = 'd0000000-0000-0000-0000-00000000aa01'),
  null,
  'a deleted poll message carries no poll'
);

select * from finish();
rollback;
