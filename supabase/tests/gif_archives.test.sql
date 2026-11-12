begin;

-- 보관 GIF(기능 명세 §18.7): GIF 첨부는 화면용 MP4 옆에 메타데이터만 지운 GIF를 함께 두고 내려받을 때 준다.
create extension if not exists pgtap with schema extensions;
select plan(30);

create temp table ids (name text primary key, id uuid, path text);
grant all on ids to authenticated;
create temp table message_targets (attachment_id uuid, object_path text, thumbnail_path text, gif_path text);
grant all on message_targets to authenticated;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

-- 게시물 ------------------------------------------------------------------------------------------

insert into ids (name, id)
values ('draft', public.create_group_post_upload_draft('20000000-0000-0000-0000-000000000002', 'identified'));

select ok(
  (
    select (attachment).gif_path = (attachment).object_path || '/gif'
    from (
      select public.prepare_post_attachment(
        (select id from ids where name = 'draft'),
        'gif-a.mp4', 'video/mp4', 4, 10, 10, 'gif', p_keep_gif => true
      ) as attachment
    ) as prepared
  ),
  'a GIF attachment can reserve its archived GIF next to the MP4'
);
insert into ids (name, id, path)
select 'post-gif', attachment.id, attachment.gif_path
from public.post_attachments as attachment
where attachment.original_filename = 'gif-a.mp4';

select is(
  (
    select (public.prepare_post_attachment(
      (select id from ids where name = 'draft'),
      'gif-b.mp4', 'video/mp4', 4, 10, 10, 'gif'
    )).gif_path
  ),
  null,
  'a client that does not send the archived GIF keeps the MP4-only shape'
);

select throws_ok(
  $$select public.prepare_post_attachment(
      (select id from ids where name = 'draft'),
      'clip.mp4', 'video/mp4', 4, 10, 10, 'video', p_keep_gif => true
    )$$,
  '22023', 'only a GIF keeps an archived GIF',
  'a video cannot reserve an archived GIF'
);

insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'post-attachments', attachment.object_path, '10000000-0000-0000-0000-000000000001',
  '{"size":4,"mimetype":"video/mp4"}'::jsonb
from public.post_attachments as attachment
where attachment.id = (select id from ids where name = 'post-gif');

select throws_ok(
  $$select public.finalize_post_attachment((select id from ids where name = 'post-gif'))$$,
  'P0002', 'uploaded GIF not found',
  'finalizing fails while the archived GIF is missing'
);

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('post-attachments', (select path from ids where name = 'post-gif'),
      '10000000-0000-0000-0000-000000000001', '{"size":31457281,"mimetype":"image/gif"}')$$,
  'the author can upload to the reserved archived GIF path'
);

select throws_ok(
  $$select public.finalize_post_attachment((select id from ids where name = 'post-gif'))$$,
  '22023', 'uploaded GIF does not match',
  'an archived GIF over 30 MiB is rejected'
);

reset role;
update storage.objects
set metadata = '{"size":4,"mimetype":"image/png"}'
where bucket_id = 'post-attachments' and name = (select path from ids where name = 'post-gif');
set local role authenticated;

select throws_ok(
  $$select public.finalize_post_attachment((select id from ids where name = 'post-gif'))$$,
  '22023', 'uploaded GIF does not match',
  'an archived GIF must be stored as image/gif'
);

reset role;
update storage.objects
set metadata = '{"size":31457280,"mimetype":"image/gif"}'
where bucket_id = 'post-attachments' and name = (select path from ids where name = 'post-gif');
set local role authenticated;

select lives_ok(
  $$select public.finalize_post_attachment((select id from ids where name = 'post-gif'))$$,
  'a GIF attachment finalizes with its archived GIF'
);

select is(
  (select gif_path from public.list_post_attachments((select id from ids where name = 'draft'))
   where attachment_id = (select id from ids where name = 'post-gif')),
  (select path from ids where name = 'post-gif'),
  'the attachment list carries the archived GIF path'
);

reset role;
select is(
  (select item ->> 'gif_path'
   from jsonb_array_elements(private.post_attachments_json((select id from ids where name = 'draft'))) as item
   where (item ->> 'attachment_id')::uuid = (select id from ids where name = 'post-gif')),
  (select path from ids where name = 'post-gif'),
  'the feed attachment JSON carries the archived GIF path'
);
set local role authenticated;

select set_config('storage.operation', 'storage.object.sign', true);
select is(
  (select count(*) from storage.objects
   where bucket_id = 'post-attachments' and name = (select path from ids where name = 'post-gif')),
  1::bigint,
  'a reader can sign the archived GIF'
);
select set_config('storage.operation', '', true);

reset role;

select ok(
  exists (
    select 1 from private.referenced_storage_objects as referenced
    where referenced.bucket = 'post-attachments'
      and referenced.object_path = (select path from ids where name = 'post-gif')
  ),
  'the orphan sweep treats the archived GIF as referenced'
);

-- 1년 보존 기간이 지나면 MP4와 함께 보관 GIF도 큐로 옮기고 더는 서명하지 않는다.
update public.post_attachments
set created_at = now() - interval '1 year 1 day', size_bytes = 512001
where id = (select id from ids where name = 'post-gif');
update storage.objects
set metadata = '{"size":512001,"mimetype":"video/mp4"}'
where bucket_id = 'post-attachments'
  and name = (select object_path from public.post_attachments where id = (select id from ids where name = 'post-gif'));
select private.cleanup_expired_records();

select ok(
  exists (
    select 1 from private.storage_cleanup_queue as queue
    where queue.object_path = (select path from ids where name = 'post-gif')
  ),
  'the retention pass queues the archived GIF with its MP4'
);

set local role authenticated;
select set_config('storage.operation', 'storage.object.sign', true);
select is(
  (select count(*) from storage.objects
   where bucket_id = 'post-attachments' and name = (select path from ids where name = 'post-gif')),
  0::bigint,
  'an expired archived GIF is no longer readable'
);
select set_config('storage.operation', '', true);
reset role;

-- 지우면 보관 GIF도 큐로 간다.
delete from private.storage_cleanup_queue;
update public.post_attachments set expired_at = null
where id = (select id from ids where name = 'post-gif');
set local role authenticated;
select lives_ok(
  $$select public.delete_post_attachment((select id from ids where name = 'post-gif'))$$,
  'the author can delete the GIF attachment'
);
reset role;
select ok(
  exists (
    select 1 from private.storage_cleanup_queue as queue
    where queue.object_path = (select path from ids where name = 'post-gif')
  ),
  'deleting a GIF attachment queues its archived GIF'
);

-- 메시지 --------------------------------------------------------------------------------------

set local role authenticated;

select throws_ok(
  $$select * from public.prepare_message_attachments(
      'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000901',
      '[{"kind":"video","mime_type":"video/mp4","size_bytes":4,"width":10,"height":10,"file_name":"clip.mp4","keep_gif":true}]'::jsonb
    )$$,
  '22023', 'only a GIF keeps an archived GIF',
  'a message video cannot reserve an archived GIF'
);

select is(
  (select gif_path from public.prepare_message_attachments(
    'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000902',
    '[{"kind":"gif","mime_type":"video/mp4","size_bytes":4,"width":10,"height":10,"file_name":"gif-b.mp4"}]'::jsonb
  )),
  null,
  'a message GIF without the archived GIF keeps the MP4-only shape'
);

insert into message_targets
select * from public.prepare_message_attachments(
  'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000901',
  '[{"kind":"gif","mime_type":"video/mp4","size_bytes":4,"width":10,"height":10,"file_name":"gif-a.mp4","keep_gif":true}]'::jsonb
);

select is(
  (select gif_path from message_targets),
  (select object_path || '/gif' from message_targets),
  'a message GIF reserves its archived GIF next to the MP4'
);

insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'message-attachments', object_path, '10000000-0000-0000-0000-000000000001',
  '{"size":4,"mimetype":"video/mp4"}'::jsonb
from message_targets;

select throws_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000901', ''
    )$$,
  'P0002', 'uploaded GIF not found',
  'sending fails while the archived GIF is missing'
);

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    select 'message-attachments', gif_path, '10000000-0000-0000-0000-000000000001',
      '{"size":4,"mimetype":"video/mp4"}'::jsonb
    from message_targets$$,
  'the sender can upload to the reserved archived GIF path'
);

select throws_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000901', ''
    )$$,
  '22023', 'uploaded GIF does not match',
  'a message archived GIF must be stored as image/gif'
);

reset role;
update storage.objects
set metadata = '{"size":4,"mimetype":"image/gif"}'
where bucket_id = 'message-attachments' and name = (select gif_path from message_targets);
set local role authenticated;

select lives_ok(
  $$select public.send_message(
      'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000901', ''
    )$$,
  'a message GIF is sent with its archived GIF'
);

select is(
  (select attachments -> 0 ->> 'gif_path'
   from public.list_messages('c0000000-0000-0000-0000-000000000001')
   where id = 'e0000000-0000-0000-0000-000000000901'),
  (select gif_path from message_targets),
  'message pages carry the archived GIF path'
);

select is(
  (select gif_path from public.list_conversation_attachments('c0000000-0000-0000-0000-000000000001', true)
   where id = (select attachment_id from message_targets)),
  (select gif_path from message_targets),
  'the shared media list carries the archived GIF path'
);

select is(
  private.can_read_message_object((select gif_path from message_targets)),
  true,
  'members can read the archived GIF'
);

reset role;

select ok(
  exists (
    select 1 from private.referenced_storage_objects as referenced
    where referenced.bucket = 'message-attachments'
      and referenced.object_path = (select gif_path from message_targets)
  ),
  'the orphan sweep treats a message archived GIF as referenced'
);

update private.message_attachments
set created_at = now() - interval '1 year 1 day', size_bytes = 512001
where id = (select attachment_id from message_targets);
select private.cleanup_expired_records();

select ok(
  exists (
    select 1 from private.storage_cleanup_queue as queue
    where queue.object_path = (select gif_path from message_targets)
  ),
  'the retention pass queues a message archived GIF with its MP4'
);

set local role authenticated;
select is(
  private.can_read_message_object((select gif_path from message_targets)),
  false,
  'an expired message archived GIF is no longer readable'
);
reset role;

-- 대화를 지우면 보관 GIF도 큐로 간다.
delete from private.storage_cleanup_queue;
update private.message_attachments set status = 'deleted'
where id = (select attachment_id from message_targets);
select private.enqueue_storage_cleanup();
select ok(
  exists (
    select 1 from private.storage_cleanup_queue as queue
    where queue.object_path = (select gif_path from message_targets)
  ),
  'removing a deleted message attachment queues its archived GIF'
);

select * from finish();
rollback;
