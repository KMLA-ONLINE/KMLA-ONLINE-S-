begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

-- 메시지 본문 상한은 grapheme 10,000자다. 서버는 grapheme을 세지 못해 code point 40,000개로 막는다.
-- seed: 홍길동(…0001)과 김민준(…0100)의 1:1 대화 c…01.
create temp table prepared (position integer, attachment_id uuid, object_path text, thumbnail_path text);
grant all on prepared to authenticated;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000801',
      repeat('가', 40000)
    )$$,
  'a body of 40,000 code points is sent'
);

select throws_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000802',
      repeat('가', 40001)
    )$$,
  '22023',
  null,
  'a body over 40,000 code points is rejected'
);

select lives_ok(
  $$select public.edit_message('e0000000-0000-0000-0000-000000000801', repeat('나', 40000))$$,
  'an edit of 40,000 code points is saved'
);

select throws_ok(
  $$select public.edit_message('e0000000-0000-0000-0000-000000000801', repeat('나', 40001))$$,
  '22023',
  null,
  'an edit over 40,000 code points is rejected'
);

-- 첨부가 있는 메시지는 본문을 따로 검사한다.
insert into prepared
select row_number() over (), *
from public.prepare_message_attachments(
  'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000803',
  '[{"kind":"file","mime_type":"application/pdf","size_bytes":4,"file_name":"a.pdf"}]'::jsonb
);

insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'message-attachments', object_path, '10000000-0000-0000-0000-000000000001',
  '{"size":4,"mimetype":"application/pdf"}'::jsonb
from prepared;

select throws_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000803',
      repeat('가', 40001)
    )$$,
  '22023',
  null,
  'a body over 40,000 code points is rejected with attachments too'
);

select lives_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000803',
      repeat('가', 40000)
    )$$,
  'a body of 40,000 code points is sent with attachments'
);

select * from finish();
rollback;
