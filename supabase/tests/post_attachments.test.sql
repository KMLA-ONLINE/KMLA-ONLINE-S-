begin;

create extension if not exists pgtap with schema extensions;
create temporary table cleanup_claims (
  attachment_id uuid,
  storage_bucket text,
  object_path text,
  lease_id uuid
);
grant select, insert on cleanup_claims to service_role;
select plan(42);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0000-000000000002',
  'authenticated', 'authenticated', 'reader@kmla.hs.kr', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000000002'
where pub_id = 'kim-admin';
insert into public.group_memberships (group_id, profile_id, role)
select '20000000-0000-0000-0000-000000000002', id, 'member'
from public.profiles
where auth_user_id = '10000000-0000-0000-0000-000000000002';

select is(enum_range(null::public.post_attachment_status)::text, '{pending,ready,deleted}', 'attachment states are fixed');
select ok((select relrowsecurity from pg_class where oid = 'public.post_attachments'::regclass), 'attachment metadata has RLS');
select ok(has_table_privilege('authenticated', 'public.post_attachments', 'SELECT'), 'metadata is readable through RLS');
select ok(not has_table_privilege('authenticated', 'public.post_attachments', 'INSERT'), 'metadata cannot be inserted directly');
select ok(not has_table_privilege('authenticated', 'public.post_attachments', 'UPDATE'), 'metadata cannot be updated directly');
select ok(not has_table_privilege('authenticated', 'public.post_attachments', 'DELETE'), 'metadata cannot be deleted directly');
select ok(not has_function_privilege('anon', 'public.prepare_post_attachment(uuid,text,text,bigint,integer,integer)', 'EXECUTE'), 'anon cannot prepare uploads');
select ok(has_function_privilege('service_role', 'private.claim_post_attachment_cleanup(integer,integer)', 'EXECUTE'), 'service role can claim cleanup work');
select ok(not has_function_privilege('authenticated', 'private.claim_post_attachment_cleanup(integer,integer)', 'EXECUTE'), 'clients cannot claim cleanup work');
select is((select public from storage.buckets where id = 'post-attachments'), false, 'attachment bucket is private');
select is((select file_size_limit from storage.buckets where id = 'post-attachments'), 31457280::bigint, 'bucket limit is 30 MiB');
select is((select allowed_mime_types from storage.buckets where id = 'post-attachments'), null::text[], 'bucket permits every MIME type');

select set_config('storage.operation', 'storage.object.sign_many', true);
select ok(
  storage.allow_any_operation(array['object.sign', 'object.sign_many']),
  'Storage batch signing operation is included in the read allowlist'
);
select set_config('storage.operation', 'storage.object.sign', true);
select ok(
  storage.allow_any_operation(array['object.sign', 'object.sign_many']),
  'Storage single signing operation is included in the read allowlist'
);
select set_config('storage.operation', '', true);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select public.create_group_post('20000000-0000-0000-0000-000000000002', '첨부 초안', '', 'anonymous', null, false)$$,
  'a blank draft can be created for uploads'
);
select is((select count(*) from public.posts where title = '첨부 초안' and published_at is null), 1::bigint, 'draft remains unpublished');
select throws_ok(
  $$select public.publish_group_post((select id from public.posts where title = '첨부 초안'))$$,
  '22023', 'published post requires a body or ready attachment', 'blank attachmentless draft cannot publish'
);
select lives_ok(
  $$select public.prepare_post_attachment(
    (select id from public.posts where title = '첨부 초안'), 'photo.webp', 'image/webp', 4, 10, 20
  )$$,
  'author can prepare an attachment'
);
select ok(
  (select object_path = post_id::text || '/' || id::text from public.post_attachments limit 1),
  'prepare returns the exact extensionless post/object UUID path'
);
select throws_ok(
  $$select public.publish_group_post((select id from public.posts where title = '첨부 초안'))$$,
  '55000', 'pending attachments must be finalized or deleted', 'pending upload blocks publication'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('post-attachments',
      (select object_path || '-wrong' from public.post_attachments limit 1),
      '10000000-0000-0000-0000-000000000001',
      '{"size":4,"mimetype":"image/webp"}')$$,
  '42501', null, 'Storage rejects a path that was not prepared'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('post-attachments',
      (select object_path from public.post_attachments limit 1),
      '10000000-0000-0000-0000-000000000001',
      '{"size":4,"mimetype":"image/webp"}')$$,
  'Storage accepts the exact pending path for its author'
);
select lives_ok(
  $$select public.finalize_post_attachment((select id from public.post_attachments limit 1))$$,
  'matching uploaded metadata finalizes'
);
select is((select status from public.post_attachments limit 1), 'ready'::public.post_attachment_status, 'finalize marks attachment ready');
select lives_ok(
  $$select public.publish_group_post((select id from public.posts where title = '첨부 초안'))$$,
  'ready attachment permits blank-body publication'
);
select is((select count(*) from public.list_post_attachments((select id from public.posts where title = '첨부 초안'))), 1::bigint, 'member can list ready metadata');
select lives_ok(
  $$select public.update_group_post((select id from public.posts where title = '첨부 초안'), '첨부만', '', null)$$,
  'a ready attachment permits a blank update'
);

select lives_ok(
  $$select public.prepare_post_attachment(
    (select id from public.posts where title = '첨부만'), 'second.bin', 'application/octet-stream', 5, null, null
  )$$,
  'published author can prepare another attachment'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    select storage_bucket, object_path, '10000000-0000-0000-0000-000000000002',
      '{"size":5,"mimetype":"application/octet-stream"}'::jsonb
    from public.post_attachments where original_filename = 'second.bin'$$,
  '42501', null, 'Storage rejects a mismatched object owner'
);
select lives_ok(
  $$select * from public.reorder_post_attachments(
    (select id from public.posts where title = '첨부만'),
    array[
      (select id from public.post_attachments where original_filename = 'second.bin'),
      (select id from public.post_attachments where original_filename = 'photo.webp')
    ]
  )$$,
  'author can atomically reorder every active attachment'
);
select is(
  (select position from public.post_attachments where original_filename = 'second.bin'),
  0,
  'reorder applies the requested position'
);
select lives_ok(
  $$select public.delete_post_attachment((select id from public.post_attachments where original_filename = 'second.bin'))$$,
  'author can tombstone a pending attachment'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is((select count(*) from public.list_post_attachments((select id from public.posts where title = '첨부만'))), 1::bigint, 'another current group member can list ready attachments');
select throws_ok(
  $$select public.delete_post_attachment((select id from public.post_attachments where original_filename = 'photo.webp'))$$,
  '42501', 'only the author can delete attachments', 'non-author cannot mutate attachments'
);
select is(
  (select count(*) from storage.objects where bucket_id = 'post-attachments'),
  0::bigint,
  'plain SQL SELECT cannot use the operation-restricted Storage read policy'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select public.delete_post_attachment((select id from public.post_attachments where original_filename = 'photo.webp'))$$,
  '22023', 'post requires a body or ready attachment', 'published blank post keeps its final ready attachment'
);
select lives_ok(
  $$select public.delete_group_post((select id from public.posts where title = '첨부만'))$$,
  'deleting a post succeeds'
);
reset role;
select is((select count(*) from public.post_attachments where status = 'deleted'), 2::bigint, 'post deletion tombstones every attachment');

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
do $$
begin
  insert into cleanup_claims
  select * from private.claim_post_attachment_cleanup(10, 300);
end;
$$;
select is((select count(*) from cleanup_claims), 2::bigint, 'cleanup worker leases tombstoned metadata');
select ok(
  private.complete_post_attachment_cleanup(
    (select attachment_id from cleanup_claims order by attachment_id limit 1),
    (select lease_id from cleanup_claims order by attachment_id limit 1),
    false
  ),
  'failed object deletion releases its lease without deleting metadata'
);
select ok(
  private.complete_post_attachment_cleanup(
    (select attachment_id from cleanup_claims order by attachment_id desc limit 1),
    (select lease_id from cleanup_claims order by attachment_id desc limit 1),
    true
  ),
  'successful object deletion completes cleanup metadata'
);
select is((select count(*) from storage.objects where bucket_id = 'post-attachments'), 1::bigint, 'cleanup RPC never deletes Storage object metadata');

reset role;
select * from finish();
rollback;
