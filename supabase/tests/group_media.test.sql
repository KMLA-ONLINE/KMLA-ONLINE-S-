begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

select is((select public from storage.buckets where id = 'group-media'), false, 'group media bucket is private');
select is((select file_size_limit from storage.buckets where id = 'group-media'), 4194304::bigint, 'group media bucket limit is 4 MiB');
select is((select allowed_mime_types from storage.buckets where id = 'group-media'), array['image/webp']::text[], 'group media bucket accepts only WebP');
select ok(not has_table_privilege('authenticated', 'public.group_media_objects', 'SELECT'), 'group media metadata is not browser-readable');
select ok(not has_function_privilege('anon', 'public.prepare_group_media(uuid,public.group_media_slot,bigint,integer,integer)', 'EXECUTE'), 'anonymous users cannot prepare group media');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select * from public.prepare_group_media('20000000-0000-0000-0000-000000000002', 'icon', 4, 512, 512)$$,
  'group owner can prepare an icon'
);

reset role;
select matches(
  (select object_path from public.group_media_objects where slot = 'icon'),
  '^20000000-0000-0000-0000-000000000002/icon/',
  'prepared icon path follows the group and slot contract'
);
select set_config(
  'test.group_media_id',
  (select id::text from public.group_media_objects where slot = 'icon'),
  true
);
select set_config(
  'test.group_media_path',
  (select object_path from public.group_media_objects where slot = 'icon'),
  true
);
set local role authenticated;
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('group-media', current_setting('test.group_media_path'),
      '10000000-0000-0000-0000-000000000001',
      '{"size":4,"mimetype":"image/webp"}'::jsonb)$$,
  'Storage accepts the exact pending path for its manager'
);
select lives_ok(
  $$select public.finalize_group_media(current_setting('test.group_media_id')::uuid)$$,
  'matching Storage metadata finalizes group media'
);
select is(
  (select icon_path from public.groups where id = '20000000-0000-0000-0000-000000000002'),
  current_setting('test.group_media_path'),
  'finalize connects the new object to the group icon slot'
);
select lives_ok(
  $$select public.remove_group_media('20000000-0000-0000-0000-000000000002', 'icon')$$,
  'owner can remove group media'
);
select is((select icon_path from public.groups where id = '20000000-0000-0000-0000-000000000002'), null::text, 'remove clears the icon slot');
reset role;
select is((select status from public.group_media_objects where slot = 'icon'), 'deleted'::public.group_media_status, 'remove tombstones media metadata');

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok(
  $$select * from public.prepare_group_media('20000000-0000-0000-0000-000000000006', 'cover', 4, 2400, 600)$$,
  '42501', 'group administrator required', 'non-member cannot prepare group media'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select * from public.prepare_group_media('20000000-0000-0000-0000-000000000001', 'cover', 4, 2400, 600)$$,
  '42501', 'group administrator required', 'ordinary group member cannot prepare group media'
);

reset role;
set local role authenticated;
select throws_ok(
  $$select * from public.prepare_group_media('20000000-0000-0000-0000-000000000002', 'cover', 4, 2399, 600)$$,
  '23514', null, 'cover dimensions must be exactly 4 to 1'
);

select * from finish();
rollback;
