begin;

create extension if not exists pgtap with schema extensions;
select plan(28);

select is(
  (select public from storage.buckets where id = 'profile-media'),
  false,
  'profile media bucket is private'
);
select is(
  (select file_size_limit from storage.buckets where id = 'profile-media'),
  4194304::bigint,
  'profile media bucket limit is 4 MiB'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'profile-media'),
  array['image/webp']::text[],
  'profile media bucket accepts only WebP'
);
select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
  'profiles remain non-updatable directly'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.update_my_profile(text,text,date,text,text,public.profile_gender,smallint,public.profile_academic_track,text,smallint,smallint,boolean,boolean)',
    'EXECUTE'
  ),
  'authenticated users can edit their profile through the RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.update_my_profile(text,text,date,text,text,public.profile_gender,smallint,public.profile_academic_track,text,smallint,smallint,boolean,boolean)',
    'EXECUTE'
  ),
  'anonymous users cannot edit profiles'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.set_my_profile_media(text,text)',
    'EXECUTE'
  ),
  'authenticated users can connect uploaded profile media'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);
select set_config(
  'test.profile_id',
  (
    select id::text
    from public.profiles
    where auth_user_id = '10000000-0000-0000-0000-000000000001'
  ),
  true
);
select set_config(
  'test.profile_media_path',
  '10000000-0000-0000-0000-000000000001/avatar/30000000-0000-0000-0000-000000000001',
  true
);

set local role authenticated;

select lives_ok(
  $$select public.update_my_profile(
      '홍길동 수정',
      '프로필 소개',
      '2007-01-01'::date,
      '+821012345678'::text,
      'student@example.com'::text,
      'male'::public.profile_gender,
      30::smallint,
      'domestic'::public.profile_academic_track,
      '학생부'::text,
      7::smallint,
      201::smallint,
      false,
      true
    )$$,
  'accepted user can edit allowed profile fields'
);

select is(
  (
    select name
    from public.get_my_profile()
  ),
  '홍길동 수정',
  'profile name is updated'
);
select is(
  (
    select contact_email
    from public.get_my_profile()
  ),
  'student@example.com',
  'contact email is updated'
);
select is(
  (
    select cohort
    from public.get_my_profile()
  ),
  29::smallint,
  'cohort cannot be changed by profile editing'
);
select is(
  (
    select allow_timeline_posts
    from public.get_my_profile()
  ),
  false,
  'timeline posting preference is updated'
);

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    values (
      'profile-media',
      current_setting('test.profile_media_path'),
      '10000000-0000-0000-0000-000000000001',
      '{"size":4,"mimetype":"image/webp"}'::jsonb
    )$$,
  'owner can upload media at their strict user UUID and object UUID path'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    values (
      'profile-media',
      current_setting('test.profile_id') || '/avatar/30000000-0000-0000-0000-000000000003',
      '10000000-0000-0000-0000-000000000001',
      '{"size":4,"mimetype":"image/webp"}'::jsonb
    )$$,
  '42501',
  null,
  'new uploads reject legacy numeric profile paths'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    values (
      'profile-media',
      '10000000-0000-0000-0000-000000000001/avatar/30000000-0000-0000-0000-000000000004.webp',
      '10000000-0000-0000-0000-000000000001',
      '{"size":4,"mimetype":"image/webp"}'::jsonb
    )$$,
  '42501',
  null,
  'new uploads require an extensionless object UUID'
);
select lives_ok(
  $$select public.set_my_profile_media(
      'avatar',
      current_setting('test.profile_media_path')
    )$$,
  'owner can connect uploaded avatar'
);
select is(
  (
    select avatar_path
    from public.get_my_profile()
  ),
  current_setting('test.profile_media_path'),
  'avatar path is connected to profile'
);
select set_config('storage.operation', 'storage.object.sign', true);
select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'profile-media'
      and name = current_setting('test.profile_media_path')
  ),
  1::bigint,
  'accepted users can sign readable profile media'
);
select set_config('storage.operation', 'storage.object.list', true);
select is(
  (select count(*) from storage.objects where bucket_id = 'profile-media'),
  0::bigint,
  'accepted users cannot list profile media objects'
);
select set_config('storage.operation', '', true);
select is(
  (
    select activity_kind
    from public.list_profile_posts(
      (select pub_id from public.get_my_profile())
    )
    where activity_media_path = current_setting('test.profile_media_path')
  ),
  'avatar_changed'::public.profile_media_activity_kind,
  'connecting an avatar creates an avatar activity post'
);
select is(
  (
    select activity_media_path
    from public.list_profile_posts(
      (select pub_id from public.get_my_profile())
    )
    where activity_kind = 'avatar_changed'
  ),
  current_setting('test.profile_media_path'),
  'the activity keeps the changed image path'
);
select is(
  (
    select can_edit
    from public.list_profile_posts(
      (select pub_id from public.get_my_profile())
    )
    where activity_kind = 'avatar_changed'
  ),
  false,
  'profile media activities cannot be edited'
);
select is(
  (
    select can_delete
    from public.list_profile_posts(
      (select pub_id from public.get_my_profile())
    )
    where activity_kind = 'avatar_changed'
  ),
  true,
  'profile media activities can be deleted by their author'
);
select lives_ok(
  $$select public.set_my_profile_media(
      'avatar',
      current_setting('test.profile_media_path')
    )$$,
  'retrying the same media connection succeeds'
);
select is(
  (
    select count(*)::integer
    from public.list_profile_posts(
      (select pub_id from public.get_my_profile())
    )
    where activity_kind = 'avatar_changed'
  ),
  1,
  'retrying the same media connection does not duplicate the activity'
);
select lives_ok(
  $$select public.remove_my_profile_media('avatar')$$,
  'owner can clear avatar'
);
select is(
  (
    select avatar_path
    from public.get_my_profile()
  ),
  null::text,
  'avatar path is cleared'
);

reset role;
select throws_ok(
  format(
    $sql$insert into public.posts (
      id, kind, body, timeline_profile_id, author_identity,
      display_author_profile_id, visibility, published_at,
      activity_kind, activity_media_path
    ) values (
      '74000000-0000-0000-0000-000000000001', 'profile', '', %1$s,
      'identified', %1$s, 'public', now(), 'avatar_changed',
      '20000000-0000-0000-0000-000000000099/avatar/30000000-0000-0000-0000-000000000099'
    )$sql$,
    current_setting('test.profile_id')
  ),
  '23514',
  'profile activity media path must belong to the timeline owner',
  'activity posts reject another users media path'
);
select * from finish();
rollback;
