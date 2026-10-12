begin;

create extension if not exists pgtap with schema extensions;
select plan(23);

-- seed: 홍길동(…0001)과 김민준(…0100)의 1:1 대화 c…01, 그룹 c…02에는 이한별이 2026-08-21에 참여했다.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000701',
  'authenticated', 'authenticated', 'attachments-outsider@kmla.hs.kr', '', now(),
  '', '', '', '', '', '', '', '', '{}', '{}', now(), now()
);
update public.profiles set auth_user_id = '10000000-0000-0000-0000-000000000701'
where pub_id = 'kim-admin';

create temp table prepared (position integer, attachment_id uuid, object_path text, thumbnail_path text);
grant all on prepared to authenticated;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$select * from public.prepare_message_attachments(
      'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000701',
      '[{"kind":"image","mime_type":"image/webp","size_bytes":4,"width":10,"height":10,"file_name":"a.webp"},
        {"kind":"file","mime_type":"application/pdf","size_bytes":4,"file_name":"b.pdf"}]'::jsonb
    )$$,
  '22023',
  null,
  'several attachments must all be photos'
);

select throws_ok(
  $$select * from public.prepare_message_attachments(
      'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000701',
      '[{"kind":"file","mime_type":"application/zip","size_bytes":40000000,"file_name":"big.zip"}]'::jsonb
    )$$,
  '23514',
  null,
  'a file over 30MiB is rejected'
);

select throws_ok(
  $$select * from public.prepare_message_attachments(
      'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000701',
      '[{"kind":"file","mime_type":"","size_bytes":4,"file_name":"clip.MOV"}]'::jsonb
    )$$,
  '22023',
  null,
  'a video is rejected even as a plain file'
);

select throws_ok(
  $$select * from public.prepare_message_attachments(
      'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000701',
      '[{"kind":"file","mime_type":"image/gif","size_bytes":4,"file_name":"funny.gif"}]'::jsonb
    )$$,
  '22023',
  null,
  'a GIF is rejected'
);

select lives_ok(
  $$select * from public.prepare_message_attachments(
      'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000709',
      (select jsonb_agg(jsonb_build_object(
        'kind', 'image', 'mime_type', 'image/webp', 'size_bytes', 4,
        'width', 10, 'height', 10, 'file_name', n || '.webp'))
       from generate_series(1, 30) as n)
    )$$,
  'one message holds up to 30 photos'
);

select throws_ok(
  $$select * from public.prepare_message_attachments(
      'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000710',
      (select jsonb_agg(jsonb_build_object(
        'kind', 'image', 'mime_type', 'image/webp', 'size_bytes', 4,
        'width', 10, 'height', 10, 'file_name', n || '.webp'))
       from generate_series(1, 31) as n)
    )$$,
  '22023',
  null,
  'a 31st photo is rejected'
);

-- 실패한 업로드를 같은 메시지 ID로 다시 예고할 수 있다.
select lives_ok(
  $$select * from public.prepare_message_attachments(
      'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000701',
      '[{"kind":"file","mime_type":"application/pdf","size_bytes":4,"file_name":"a.pdf"}]'::jsonb
    )$$,
  'a failed upload can be prepared again under the same message id'
);

insert into prepared
select row_number() over (), *
from public.prepare_message_attachments(
  'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000701',
  '[{"kind":"image","mime_type":"image/webp","size_bytes":4,"width":30,"height":20,"file_name":"축제 사진.webp"},
    {"kind":"image","mime_type":"image/webp","size_bytes":4,"width":20,"height":20,"file_name":"둘째 사진.webp"}]'::jsonb
);

select ok(
  (select count(*) = 2 from prepared)
    and (select thumbnail_path is not null from prepared where position = 1)
    and (select thumbnail_path is not null from prepared where position = 2),
  'preparing returns exact paths, with a thumbnail path for each photo'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    values (
      'message-attachments',
      'c0000000-0000-0000-0000-000000000001/not-prepared',
      '10000000-0000-0000-0000-000000000001',
      '{"size":4,"mimetype":"image/webp"}'
    )$$,
  '42501',
  null,
  'Storage rejects an unprepared path'
);

insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'message-attachments', object_path, '10000000-0000-0000-0000-000000000001',
  '{"size":4,"mimetype":"image/webp"}'::jsonb
from prepared;

select throws_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000701', '',
      'd0000000-0000-0000-0000-000000000001'
    )$$,
  '22023',
  null,
  'attachments are not sent as a reply'
);

select lives_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000701', ''
    )$$,
  'a message can carry attachments without a body'
);

select results_eq(
  $$select body, jsonb_path_query_array(attachments, '$[*].file_name'),
      attachments -> 0 ->> 'thumbnail_path'
    from public.list_messages('c0000000-0000-0000-0000-000000000001')
    where id = 'e0000000-0000-0000-0000-000000000701'$$,
  $$values (''::text, '["축제 사진.webp", "둘째 사진.webp"]'::jsonb, null::text)$$,
  'pages carry the attachments in order with decrypted names, and drop a missing thumbnail'
);

select is(
  (select last_message_attachment_kind
    from public.list_conversations('c0000000-0000-0000-0000-000000000001')),
  'image',
  'the list previews an attachment-only message by its first attachment'
);

select results_eq(
  $$select media_count, file_count
    from public.get_conversation_attachment_counts('c0000000-0000-0000-0000-000000000001')$$,
  $$values (2, 0)$$,
  'shared media counts photos'
);

select is(
  (select count(*) from public.list_conversation_attachments(
    'c0000000-0000-0000-0000-000000000001', true
  )),
  2::bigint,
  'the shared media list returns the conversation attachments'
);

reset role;

select ok(
  not exists (
    select 1 from private.message_attachments
    where position(convert_to('축제', 'UTF8') in filename_ciphertext) > 0
  ),
  'file names are stored only as ciphertext'
);

select results_eq(
  $$select private.can_read_message_object((select object_path from prepared where position = 1))$$,
  $$values (true)$$,
  'members can read the uploaded object'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000701', true);

select is(
  private.can_read_message_object((select object_path from prepared where position = 1)),
  false,
  'people outside the conversation cannot read the object'
);

-- 첨부 지우기

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select public.remove_message_attachment((select attachment_id from prepared where position = 2));

select is(
  (select jsonb_array_length(attachments) from public.list_messages('c0000000-0000-0000-0000-000000000001')
    where id = 'e0000000-0000-0000-0000-000000000701'),
  1,
  'the sender can remove one attachment'
);

select public.remove_message_attachment((select attachment_id from prepared where position = 1));

select is(
  (select deleted from public.list_messages('c0000000-0000-0000-0000-000000000001')
    where id = 'e0000000-0000-0000-0000-000000000701'),
  true,
  'removing the last attachment of a message without a body deletes the message'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;

select throws_ok(
  $$select public.remove_message_attachment(gen_random_uuid())$$,
  'P0002',
  null,
  'nobody removes an attachment they do not own'
);

reset role;

select is(
  private.can_read_message_object((select object_path from prepared where position = 1)),
  false,
  'a removed attachment can no longer be read'
);

-- 정리 작업이 지운 첨부의 object를 큐로 옮긴다.
select private.enqueue_storage_cleanup();

select is(
  (select count(*) from private.storage_cleanup_queue
    where bucket = 'message-attachments'
      and object_path in (select object_path from prepared)
      and reason = 'message_attachment'),
  2::bigint,
  'storage cleanup queues the objects of removed attachments'
);

select * from finish();

rollback;
