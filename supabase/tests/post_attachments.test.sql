begin;

create extension if not exists pgtap with schema extensions;
create temporary table cleanup_claims (
  id uuid,
  bucket text,
  object_path text,
  lease_id uuid
);
grant select, insert on cleanup_claims to service_role;
create temporary table attachment_test_ids (name text primary key, id uuid not null);
grant select, insert on attachment_test_ids to authenticated;
select plan(65);

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
select is(
  (
    select count(*)::integer
    from (values ('INSERT'), ('UPDATE'), ('DELETE')) as verb(privilege)
    where has_table_privilege('authenticated', 'public.post_attachments', verb.privilege)
  ),
  0,
  'attachment metadata is written only through the definer RPCs'
);
select ok(not has_function_privilege('anon', 'public.prepare_post_attachment(uuid,text,text,bigint,integer,integer)', 'EXECUTE'), 'anon cannot prepare uploads');
select ok(
  has_function_privilege('authenticated', 'public.create_group_post_upload_draft(uuid,public.post_identity)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.create_group_post_upload_draft(uuid,public.post_identity)', 'EXECUTE'),
  'only authenticated clients can create group upload drafts'
);
select ok(
  has_function_privilege('authenticated', 'public.update_group_post_draft_identity(uuid,public.post_identity)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.update_group_post_draft_identity(uuid,public.post_identity)', 'EXECUTE'),
  'only authenticated clients can change a group upload draft identity'
);
select ok(has_function_privilege('service_role', 'private.claim_storage_cleanup(integer,integer)', 'EXECUTE'), 'service role can claim cleanup work');
select ok(not has_function_privilege('authenticated', 'private.claim_storage_cleanup(integer,integer)', 'EXECUTE'), 'clients cannot claim cleanup work');
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
  $$insert into attachment_test_ids values (
      'limit_draft', public.create_group_post_upload_draft(
        '20000000-0000-0000-0000-000000000002', 'identified'
      )
    )$$,
  'an upload draft can be created before a title exists'
);
select lives_ok(
  $$select public.prepare_post_attachment(
      (select id from attachment_test_ids where name = 'limit_draft'),
      'file-' || n::text, 'application/octet-stream', 1, null, null
    ) from generate_series(1, 30) as n$$,
  'a post accepts 30 prepared attachments'
);
select is(
  (select count(*) from public.post_attachments
   where post_id = (select id from attachment_test_ids where name = 'limit_draft')),
  30::bigint,
  'all 30 attachment rows are retained'
);
select throws_ok(
  $$select public.prepare_post_attachment(
      (select id from attachment_test_ids where name = 'limit_draft'),
      'file-31', 'application/octet-stream', 1, null, null
    )$$,
  '23514', 'a post can have at most 30 attachments',
  'a 31st attachment is rejected'
);

reset role;
delete from public.posts where id = (select id from attachment_test_ids where name = 'limit_draft');
set local role authenticated;

select lives_ok(
  $$insert into attachment_test_ids values (
      'upload_draft', public.create_group_post_upload_draft(
        '20000000-0000-0000-0000-000000000002', 'anonymous'
      )
    )$$,
  'an anonymous upload draft can be created without a user title'
);
select is(
  (select count(*) from public.posts
   where id = (select id from attachment_test_ids where name = 'upload_draft')
     and published_at is null),
  1::bigint,
  'the upload draft remains unpublished'
);
select lives_ok(
  $$select public.update_group_post_draft_identity(
      (select id from attachment_test_ids where name = 'upload_draft'), 'identified'
    )$$,
  'the author can change an unpublished upload draft to identified'
);
select ok(
  (select author_identity = 'identified' and display_author_profile_id is not null
   from public.posts where id = (select id from attachment_test_ids where name = 'upload_draft')),
  'changing to identified updates both identity fields'
);

reset role;
update public.groups set identity_policy = 'identified'
where id = '20000000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok(
  $$select public.update_group_post_draft_identity(
      (select id from attachment_test_ids where name = 'upload_draft'), 'anonymous'
    )$$,
  '42501', 'anonymous posting is not allowed',
  'draft identity changes recheck the current group identity policy'
);
reset role;
update public.groups set identity_policy = 'optional_anonymous'
where id = '20000000-0000-0000-0000-000000000002';
insert into private.group_anonymous_activity_restrictions (
  group_id, profile_id, reason, expires_at, restricted_by_profile_id, source_kind
)
select '20000000-0000-0000-0000-000000000002', target.id,
  '업로드 초안 신원 변경 제한 검사', now() + interval '1 day', moderator.id, 'post'
from public.profiles as target
cross join public.profiles as moderator
where target.auth_user_id = '10000000-0000-0000-0000-000000000001'
  and moderator.auth_user_id = '10000000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok(
  $$select public.update_group_post_draft_identity(
      (select id from attachment_test_ids where name = 'upload_draft'), 'anonymous'
    )$$,
  '42501', 'anonymous activity is restricted',
  'draft identity changes recheck the current anonymous restriction'
);
select throws_ok(
  $$select public.create_group_post_upload_draft(
      '20000000-0000-0000-0000-000000000002', 'anonymous'
    )$$,
  '42501', 'anonymous activity is restricted',
  'upload draft creation enforces anonymous restrictions'
);
reset role;
delete from private.group_anonymous_activity_restrictions
where group_id = '20000000-0000-0000-0000-000000000002';
set local role authenticated;
select lives_ok(
  $$select public.update_group_post_draft_identity(
      (select id from attachment_test_ids where name = 'upload_draft'), 'anonymous'
    )$$,
  'the author can change the draft back to an allowed anonymous identity'
);
select is(
  (select display_author_profile_id from public.posts
   where id = (select id from attachment_test_ids where name = 'upload_draft')),
  null::bigint,
  'anonymous draft identity removes the display profile'
);
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select lives_ok(
  $$insert into attachment_test_ids values (
      'member_draft', public.create_group_post_upload_draft(
        '20000000-0000-0000-0000-000000000002', 'identified'
      )
    )$$,
  'a plain member can create an identified upload draft'
);
select throws_ok(
  $$select public.update_group_post_draft_identity(
      (select id from attachment_test_ids where name = 'member_draft'), 'staff'
    )$$,
  '42501', 'staff identity is not allowed',
  'a plain member cannot switch their draft to staff identity'
);
select is(
  (select count(*) from public.list_group_posts('20000000-0000-0000-0000-000000000002')
   where post_id = (select id from attachment_test_ids where name = 'upload_draft')),
  0::bigint,
  'another member cannot see the unpublished draft'
);
select throws_ok(
  $$select public.update_group_post_draft_identity(
      (select id from attachment_test_ids where name = 'upload_draft'), 'identified'
    )$$,
  '42501', 'only the author can change an unpublished group draft identity',
  'a non-author cannot change the draft identity'
);

reset role;
delete from public.posts where id = (select id from attachment_test_ids where name = 'member_draft');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select public.publish_group_post((select id from attachment_test_ids where name = 'upload_draft'))$$,
  '22023', 'published post requires a body or ready attachment', 'blank attachmentless draft cannot publish'
);
select lives_ok(
  $$select public.prepare_post_attachment(
    (select id from attachment_test_ids where name = 'upload_draft'), 'photo.webp', 'image/webp', 4, 10, 20
  )$$,
  'author can prepare an attachment'
);
select ok(
  (select object_path = post_id::text || '/' || id::text from public.post_attachments limit 1),
  'prepare returns the exact extensionless post/object UUID path'
);
select throws_ok(
  $$select public.publish_group_post((select id from attachment_test_ids where name = 'upload_draft'))$$,
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
  $$select public.finalize_post_attachment((select id from public.post_attachments limit 1))$$,
  'finalize is idempotent for the same author after validation'
);
select lives_ok(
  $$select public.update_group_post_draft_identity(
      (select id from attachment_test_ids where name = 'upload_draft'), 'identified'
    )$$,
  'the author can change identity after upload without preparing again'
);
select is(
  (select count(*) from public.post_attachments
   where post_id = (select id from attachment_test_ids where name = 'upload_draft')
     and status = 'ready'),
  1::bigint,
  'changing draft identity retains the finalized attachment'
);
select lives_ok(
  $$select public.update_group_post_draft_identity(
      (select id from attachment_test_ids where name = 'upload_draft'), 'anonymous'
    )$$,
  'the draft can return to its selected anonymous identity without reupload'
);
select lives_ok(
  $$select public.commit_group_post(
      (select id from attachment_test_ids where name = 'upload_draft'),
      '첨부 초안', '', array[(select id from public.post_attachments limit 1)], false, null
    )$$,
  'the first real title is stored before publication'
);
select lives_ok(
  $$select public.publish_group_post((select id from attachment_test_ids where name = 'upload_draft'))$$,
  'ready attachment permits blank-body publication'
);
select is((select count(*) from public.list_post_attachments((select id from public.posts where title = '첨부 초안'))), 1::bigint, 'member can list ready metadata');
select throws_ok(
  $$select public.update_group_post_draft_identity(
      (select id from attachment_test_ids where name = 'upload_draft'), 'identified'
    )$$,
  '42501', 'only the author can change an unpublished group draft identity',
  'published post identity remains immutable'
);
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

-- 정리는 두 단계다. 하루 한 번 SQL이 수명을 다한 행을 큐로 옮기고, 워커가 큐를 드레인한다.
select is(
  private.enqueue_storage_cleanup(),
  2::bigint,
  'the daily pass moves both tombstoned attachments into the queue'
);
select is(
  (select count(*) from public.post_attachments where status = 'deleted'),
  0::bigint,
  'the source rows leave with the same statement that queues their objects'
);

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
insert into cleanup_claims
select * from public.claim_storage_cleanup(10, 300);
select is((select count(*) from cleanup_claims), 2::bigint, 'the worker leases the queued objects');
select is(
  public.complete_storage_cleanup(
    (select lease_id from cleanup_claims limit 1),
    (select array_agg(id) from cleanup_claims),
    '{}'::uuid[],
    'storage unavailable'
  ),
  1,
  'the queued object that no longer exists in Storage completes anyway'
);
select is(
  (select count(*) from storage.objects where bucket_id = 'post-attachments'),
  1::bigint,
  'the cleanup RPCs never touch Storage object metadata themselves'
);

reset role;
select is(
  (select count(*) from private.storage_cleanup_queue),
  1::bigint,
  'the object that is still in Storage stays queued for the next run'
);

reset role;
select * from finish();
rollback;
