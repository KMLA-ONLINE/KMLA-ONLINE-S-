begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

-- 그룹 대화 이미지(기능 명세 §13.29). 모든 현재 멤버가 바꾸거나 지우고, 바뀌면 시스템 메시지를 남긴다.
-- seed: 홍길동(…0001)과 김민준(…0100)이 그룹 대화 c…02와 1:1 대화 c…01에 있다.

select ok(
  not has_function_privilege('anon', 'public.prepare_conversation_image(uuid,bigint,integer,integer)', 'EXECUTE'),
  'anonymous users cannot prepare a conversation image'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$select * from public.prepare_conversation_image('c0000000-0000-0000-0000-000000000001', 4, 512, 512)$$,
  '42501',
  'group member required',
  'a direct chat has no image'
);

select throws_ok(
  $$select * from public.prepare_conversation_image('c0000000-0000-0000-0000-0000000000ff', 4, 512, 512)$$,
  '42501',
  'group member required',
  'a conversation I am not in cannot get an image'
);

select throws_ok(
  $$select * from public.prepare_conversation_image('c0000000-0000-0000-0000-000000000002', 4, 513, 512)$$,
  '23514',
  null,
  'the image must be square and at most 512px'
);

select lives_ok(
  $$select set_config('test.image_id', image_id::text, true),
      set_config('test.image_path', object_path, true)
    from public.prepare_conversation_image('c0000000-0000-0000-0000-000000000002', 4, 512, 512)$$,
  'a member can prepare a group image'
);

select is(
  current_setting('test.image_path'),
  'c0000000-0000-0000-0000-000000000002/' || current_setting('test.image_id'),
  'the object path is the conversation id and the image id'
);

select throws_ok(
  $$select public.finalize_conversation_image(current_setting('test.image_id')::uuid)$$,
  'P0002',
  'uploaded object not found',
  'finalize needs the uploaded object'
);

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('conversation-media', current_setting('test.image_path'),
      '10000000-0000-0000-0000-000000000001',
      '{"size":4,"mimetype":"image/webp"}'::jsonb)$$,
  'Storage accepts the exact pending path for the member'
);

select lives_ok(
  $$select public.finalize_conversation_image(current_setting('test.image_id')::uuid)$$,
  'matching Storage metadata finalizes the image'
);

select is(
  (select image_path from public.list_conversations('c0000000-0000-0000-0000-000000000002')),
  current_setting('test.image_path'),
  'the conversation now carries the image'
);

select results_eq(
  $$select system_kind from public.list_messages('c0000000-0000-0000-0000-000000000002')
    where system_kind in ('image_changed', 'image_removed')$$,
  $$values ('image_changed'::text)$$,
  'changing the image leaves a system message'
);

select ok(
  private.can_read_conversation_image(current_setting('test.image_path')),
  'a member can read the current image object'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;

select is(
  (select image_path from public.list_conversations('c0000000-0000-0000-0000-000000000002')),
  current_setting('test.image_path'),
  'the other member sees the same image'
);

-- 바꾸면 이전 object 행은 정리 대상이 된다.
select lives_ok(
  $$select set_config('test.image2_id', image_id::text, true),
      set_config('test.image2_path', object_path, true)
    from public.prepare_conversation_image('c0000000-0000-0000-0000-000000000002', 4, 256, 256)$$,
  'the other member can prepare a replacement'
);

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('conversation-media', current_setting('test.image2_path'),
      '10000000-0000-0000-0000-000000000100',
      '{"size":4,"mimetype":"image/webp"}'::jsonb);
    select public.finalize_conversation_image(current_setting('test.image2_id')::uuid)$$,
  'the replacement finalizes'
);

-- 예고 행은 클라이언트 역할이 읽을 수 없으므로 postgres로 확인한다.
reset role;

select is(
  (select status::text from public.conversation_image_objects where object_path = current_setting('test.image_path')),
  'deleted',
  'the replaced object row is marked for cleanup'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;

select lives_ok(
  $$select public.remove_conversation_image('c0000000-0000-0000-0000-000000000002')$$,
  'any member can remove the image'
);

select is(
  (select image_path from public.list_conversations('c0000000-0000-0000-0000-000000000002')),
  null,
  'removing clears the image'
);

select results_eq(
  $$select system_kind from public.list_messages('c0000000-0000-0000-0000-000000000002')
    where system_kind in ('image_changed', 'image_removed')
    order by sent_at$$,
  $$values ('image_changed'::text), ('image_changed'::text), ('image_removed'::text)$$,
  'every change and the removal leave system messages in order'
);

select * from finish();
rollback;
