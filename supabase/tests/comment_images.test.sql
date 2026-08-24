begin;

create extension if not exists pgtap with schema extensions;
select plan(38);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0000-000000000002',
  'authenticated', 'authenticated', 'image-other@kmla.hs.kr', '', now(),
  '', '', '', '', '', '', '', '', '{}', '{}', now(), now()
);

update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000000002'
where pub_id = 'kim-admin';
insert into public.group_memberships (group_id, profile_id, role)
select post.group_id, profile.id, 'member'
from public.posts as post
cross join public.profiles as profile
where post.id = '90000000-0000-0000-0000-000000000003'
  and profile.auth_user_id = '10000000-0000-0000-0000-000000000002'
on conflict (group_id, profile_id) do nothing;

create temporary table image_ids (
  name text primary key,
  id uuid,
  post_id uuid,
  storage_bucket text,
  object_path text
);
create temporary table comment_ids (name text primary key, id uuid);
create temporary table cleanup_claims (
  image_id uuid,
  storage_bucket text,
  object_path text,
  lease_id uuid
);
grant select, insert on image_ids, comment_ids to authenticated;
grant select on image_ids, comment_ids to service_role;
grant select, insert on cleanup_claims to service_role;

select is(
  enum_range(null::public.comment_image_status)::text,
  '{pending,finalized,ready,deleted}',
  'comment image states separate upload, finalize, attachment, and deletion'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.comment_images'::regclass),
  'public comment image metadata has RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'private.comment_image_uploaders'::regclass),
  'private uploader ownership has RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.comment_images', 'SELECT'),
  'clients have no direct metadata reads'
);
select ok(
  not has_table_privilege('authenticated', 'private.comment_image_uploaders', 'SELECT'),
  'uploader identity is not client-readable'
);
select ok(
  not has_function_privilege('anon', 'public.prepare_comment_image(uuid,text,bigint,integer,integer)', 'EXECUTE'),
  'anonymous visitors cannot prepare images'
);
select ok(
  has_function_privilege('authenticated', 'public.list_comment_images(uuid[])', 'EXECUTE'),
  'accepted clients can use the safe batch metadata RPC'
);
select ok(
  has_function_privilege('service_role', 'private.claim_comment_image_cleanup(integer,integer)', 'EXECUTE'),
  'only the cleanup worker is granted leases'
);
select ok(
  not has_function_privilege('authenticated', 'private.claim_comment_image_cleanup(integer,integer)', 'EXECUTE'),
  'clients cannot claim cleanup leases'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$select public.prepare_comment_image(
      '90000000-0000-0000-0000-000000000003', 'image/png', 4, 10, 20
    )$$,
  '22023', 'invalid normalized comment image metadata',
  'prepare accepts only normalized WebP metadata'
);
select throws_ok(
  $$select public.prepare_comment_image(
      '90000000-0000-0000-0000-000000000003', 'image/webp', 8388609, 10, 20
    )$$,
  '22023', 'invalid normalized comment image metadata',
  'prepare enforces the 8 MiB limit'
);
select throws_ok(
  $$select public.prepare_comment_image(
      '90000000-0000-0000-0000-000000000003', 'image/webp', 4, 3073, 20
    )$$,
  '22023', 'invalid normalized comment image metadata',
  'prepare enforces the 3072 pixel long edge'
);

insert into image_ids
select 'first', id, post_id, storage_bucket, object_path
from public.prepare_comment_image(
  '90000000-0000-0000-0000-000000000003', 'image/webp', 4, 10, 20
);
select ok(
  (
    select object_path = 'comments/' || post_id::text || '/' || id::text
    from image_ids where name = 'first'
  ),
  'prepare reserves the exact extensionless comments/post/image path'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    values (
      'post-attachments',
      (select object_path || '-wrong' from image_ids where name = 'first'),
      '10000000-0000-0000-0000-000000000001',
      '{"size":4,"mimetype":"image/webp"}'
    )$$,
  '42501', null, 'Storage rejects an unprepared path'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    select storage_bucket, object_path, '10000000-0000-0000-0000-000000000001',
      '{"size":4,"mimetype":"image/webp"}'::jsonb
    from image_ids where name = 'first'$$,
  'Storage accepts the exact prepared path and owner'
);
select lives_ok(
  $$select public.finalize_comment_image((select id from image_ids where name = 'first'))$$,
  'matching uploaded metadata finalizes the image'
);
select is(
  (select count(*) from public.list_comment_images(array[]::uuid[])),
  0::bigint,
  'a finalized uncommitted image is not visible'
);
select set_config('storage.operation', 'storage.object.sign', true);
select is(
  (select count(*) from storage.objects
    where bucket_id = 'post-attachments'
      and name = (select object_path from image_ids where name = 'first')),
  0::bigint,
  'a finalized uncommitted image cannot be signed'
);
select set_config('storage.operation', '', true);

insert into comment_ids
select 'image_only', comment_id
from public.create_post_comment(
  '90000000-0000-0000-0000-000000000003', '', 'identified', null,
  (select id from image_ids where name = 'first')
);
select is(
  (select body from public.list_post_comments('90000000-0000-0000-0000-000000000003')
    where comment_id = (select id from comment_ids where name = 'image_only')),
  '',
  'an image-only comment is created atomically'
);
select is(
  (select count(*) from public.list_comment_images(
    array[(select id from comment_ids where name = 'image_only')])),
  1::bigint,
  'the batch RPC returns a committed ready image'
);
select set_config('storage.operation', 'storage.object.sign_many', true);
select is(
  (select count(*) from storage.objects
    where bucket_id = 'post-attachments'
      and name = (select object_path from image_ids where name = 'first')),
  1::bigint,
  'a committed image can be signed'
);
select set_config('storage.operation', '', true);

insert into image_ids
select 'replacement', id, post_id, storage_bucket, object_path
from public.prepare_comment_image(
  '90000000-0000-0000-0000-000000000003', 'image/webp', 6, 50, 60
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    select storage_bucket, object_path, '10000000-0000-0000-0000-000000000001',
      '{"size":6,"mimetype":"image/webp"}'::jsonb
    from image_ids where name = 'replacement'$$,
  'the author can upload a prepared replacement'
);
select lives_ok(
  $$select public.finalize_comment_image((select id from image_ids where name = 'replacement'))$$,
  'the author can finalize a replacement'
);
select lives_ok(
  $$select * from public.update_post_comment(
      (select id from comment_ids where name = 'image_only'), '',
      (select id from image_ids where name = 'replacement')
    )$$,
  'an image-only edit atomically replaces the image'
);
reset role;
select is(
  (select status from public.comment_images where id = (select id from image_ids where name = 'first')),
  'deleted'::public.comment_image_status,
  'replacement tombstones the prior image'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(
  (select image_id from public.list_comment_images(
    array[(select id from comment_ids where name = 'image_only')])),
  (select id from image_ids where name = 'replacement'),
  'the replacement is the only readable comment image'
);
select lives_ok(
  $$select * from public.update_post_comment(
      (select id from comment_ids where name = 'image_only'), '본문만 수정'
    )$$,
  'a body-only edit retains the existing image'
);
select is(
  (select image_id from public.list_comment_images(
    array[(select id from comment_ids where name = 'image_only')])),
  (select id from image_ids where name = 'replacement'),
  'omitting image edit arguments does not remove the image'
);

insert into image_ids
select 'other_user', id, post_id, storage_bucket, object_path
from public.prepare_comment_image(
  '90000000-0000-0000-0000-000000000003', 'image/webp', 5, 30, 40
);
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    select storage_bucket, object_path, '10000000-0000-0000-0000-000000000002',
      '{"size":5,"mimetype":"image/webp"}'::jsonb
    from image_ids where name = 'other_user'$$,
  '42501', null, 'another user cannot upload to the preparer path'
);
select throws_ok(
  $$select public.finalize_comment_image((select id from image_ids where name = 'other_user'))$$,
  '42501', 'only the uploader can finalize a comment image',
  'another user cannot finalize the preparer image'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select * from public.update_post_comment(
      (select id from comment_ids where name = 'image_only'), '사진을 제거했습니다', null, true
    )$$,
  'an author can remove an image while adding a body'
);
reset role;
select is(
  (select status from public.comment_images
    where id = (select id from image_ids where name = 'replacement')),
  'deleted'::public.comment_image_status,
  'removal tombstones the old image immediately'
);
select ok(
  (select edited_at is not null from public.post_comments
    where id = (select id from comment_ids where name = 'image_only')),
  'an image change stamps edited_at'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select * from public.update_post_comment(
      (select id from comment_ids where name = 'image_only'), '', null, true
    )$$,
  '22023', 'comment requires a body or finalized image',
  'editing cannot remove both body and image'
);
select is(
  (select count(*) from public.list_comment_images(
    array[(select id from comment_ids where name = 'image_only')])),
  0::bigint,
  'a removed image disappears from metadata reads immediately'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
insert into cleanup_claims
select * from private.claim_comment_image_cleanup(100, 300);
select ok(
  exists (
    select 1 from cleanup_claims
    where image_id = (select id from image_ids where name = 'first')
  ),
  'cleanup leases a tombstoned comment image'
);
select ok(
  private.complete_comment_image_cleanup(
    (select image_id from cleanup_claims
      where image_id = (select id from image_ids where name = 'first')),
    (select lease_id from cleanup_claims
      where image_id = (select id from image_ids where name = 'first')),
    true
  ),
  'cleanup completion removes leased metadata'
);
reset role;
select is(
  (select count(*) from public.comment_images
    where id = (select id from image_ids where name = 'first')),
  0::bigint,
  'completed cleanup removes the public metadata and private uploader row by cascade'
);

select * from finish();
rollback;
