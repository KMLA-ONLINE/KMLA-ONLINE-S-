begin;

create extension if not exists pgtap with schema extensions;
select plan(34);

-- 이 파일의 목적은 두 가지다. 1층이 수명을 다한 행만 큐로 옮기는지, 그리고 2층 스윕이 살아 있는
-- object를 절대 후보로 삼지 않는지. 후자가 틀리면 사용자 이미지가 사라지므로 참조 종류마다
-- 하나씩 확인한다.

select ok(
  (select relrowsecurity from pg_class where oid = 'private.storage_cleanup_queue'::regclass),
  'the cleanup queue has RLS'
);
select ok(
  not has_table_privilege('authenticated', 'private.storage_cleanup_queue', 'SELECT'),
  'clients cannot read the cleanup queue'
);
select ok(
  not has_table_privilege('authenticated', 'public.profile_media_objects', 'SELECT'),
  'clients cannot read profile media metadata directly'
);
select ok(
  has_function_privilege('service_role', 'public.claim_storage_cleanup(integer,integer)', 'EXECUTE'),
  'the worker can claim'
);
select ok(
  not has_function_privilege('authenticated', 'public.claim_storage_cleanup(integer,integer)', 'EXECUTE'),
  'clients cannot claim'
);
select ok(
  not has_function_privilege('anon', 'public.admin_storage_cleanup_status()', 'EXECUTE'),
  'anonymous visitors cannot read cleanup status'
);
select throws_ok(
  $$select private.claim_storage_cleanup(0, 300)$$,
  '22023', 'invalid cleanup lease parameters',
  'claim rejects an out-of-range batch size'
);

-- 설정이 없으면 조용히 null을 돌려주는 대신 실패해야 한다. 이 침묵이 정리가 한 번도 돌지 않은
-- 것을 아무도 모르게 만들었던 원인이다.
delete from vault.secrets where name = 'storage_cleanup_secret';
select throws_ok(
  $$select private.invoke_storage_cleanup()$$,
  '55000', 'storage cleanup vault configuration is missing',
  'a missing secret fails loudly instead of no-opping'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000098', true);
select is(
  (select secrets_configured from public.admin_storage_cleanup_status()),
  false,
  'the admin status reports the missing configuration'
);
select set_config('request.jwt.claim.sub', '', true);

-- 1층: 상태로 판단하는 세 종류.
insert into public.post_attachments (
  id, post_id, storage_bucket, object_path, position, mime_type, size_bytes,
  original_filename, status, created_at, deleted_at
)
select
  ('aa000000-0000-0000-0000-00000000000' || suffix)::uuid,
  '90000000-0000-0000-0000-000000000003',
  'post-attachments',
  '90000000-0000-0000-0000-000000000003/aa000000-0000-0000-0000-00000000000' || suffix,
  suffix + 5,
  'image/webp',
  4,
  'x.webp',
  status::public.post_attachment_status,
  created_at,
  case when status = 'deleted' then now() end
from (values
  (1, 'pending', now()),
  (2, 'pending', now() - interval '72 hours'),
  (3, 'deleted', now()),
  (4, 'deleted', now())
) as sample(suffix, status, created_at);

select is(
  private.enqueue_storage_cleanup(),
  3::bigint,
  'only the abandoned pending row and the tombstones move to the queue'
);
select ok(
  exists (
    select 1 from private.storage_cleanup_queue
    where object_path like '%aa000000-0000-0000-0000-000000000002'
      and reason = 'post_attachment'
  ),
  'a pending attachment older than 48 hours is queued'
);
select ok(
  exists (
    select 1 from private.storage_cleanup_queue
    where object_path like '%aa000000-0000-0000-0000-000000000003'
  ),
  'a deleted attachment is queued'
);
select ok(
  exists (
    select 1 from public.post_attachments
    where object_path like '%aa000000-0000-0000-0000-000000000001'
  ),
  'a fresh pending attachment is left alone'
);
select is(
  (
    select count(*) from public.post_attachments
    where object_path like '%aa000000-0000-0000-0000-00000000000%'
  ),
  1::bigint,
  'queued rows leave the source table in the same statement'
);

-- 02와 03은 Storage에 실물이 있고 04는 이미 없다. 세 가지 완료 경로를 한 배치에서 가른다.
insert into storage.objects (bucket_id, name, metadata, created_at)
values
 ('post-attachments', '90000000-0000-0000-0000-000000000003/aa000000-0000-0000-0000-000000000002',
  '{"size":4}'::jsonb, now() - interval '72 hours'),
 ('post-attachments', '90000000-0000-0000-0000-000000000003/aa000000-0000-0000-0000-000000000003',
  '{"size":4}'::jsonb, now() - interval '72 hours');

-- 워커 왕복. 리스는 claim 한 번에 하나이고, 완료는 배치 단위다.
create temporary table claims as
select * from private.claim_storage_cleanup(100, 300);
select is(
  (select count(distinct lease_id) from claims),
  1::bigint,
  'one claim call issues one lease for the whole batch'
);

-- Storage가 아무것도 못 지웠다고 보고한 경우. 그래도 실물이 이미 없는 04는 완료해야 한다.
-- 완료하지 않으면 응답에 영영 담기지 않는 항목이 큐에서 빠져나갈 길이 없다.
select is(
  private.complete_storage_cleanup(
    (select lease_id from claims limit 1),
    (select array_agg(id) from claims),
    '{}'::uuid[],
    'storage unavailable'
  ),
  1,
  'an object that is already gone completes even though Storage reported nothing'
);
select is(
  (select count(*) from private.storage_cleanup_queue),
  2::bigint,
  'objects that still exist stay queued'
);
select is(
  (select max(attempts) from private.storage_cleanup_queue),
  1,
  'failure increments the attempt counter instead of dropping the object'
);
select ok(
  (select min(next_attempt_at) from private.storage_cleanup_queue) > now(),
  'a failed item backs off before the next try'
);
select is(
  (select count(*) from private.claim_storage_cleanup(100, 300)),
  0::bigint,
  'an item inside its backoff window is not claimed again'
);

-- 부분 실패. Storage가 둘 중 하나만 지웠다고 보고한다. 배치를 통째로 성공 처리하면 지워지지
-- 않은 object의 큐 행까지 사라져 추적을 영영 잃는다.
update private.storage_cleanup_queue set next_attempt_at = now();
delete from claims;
insert into claims select * from private.claim_storage_cleanup(100, 300);
select is(
  private.complete_storage_cleanup(
    (select lease_id from claims limit 1),
    (select array_agg(id) from claims),
    (select array_agg(id) from (
      select id from claims where object_path like '%000000000002' 
    ) as reported),
    null
  ),
  1,
  'only the object Storage actually removed is completed'
);
select is(
  (select count(*) from private.storage_cleanup_queue),
  1::bigint,
  'the object that was not removed stays queued instead of being dropped'
);
select is(
  (select attempts from private.storage_cleanup_queue),
  2,
  'the surviving item keeps counting its attempts'
);

-- 2층: 참조가 살아 있는 object는 어떤 종류든 후보가 되지 않아야 한다.
set local role postgres;
insert into storage.objects (bucket_id, name, owner_id, metadata, created_at)
values
  ('profile-media', '10000000-0000-0000-0000-000000000001/avatar/bb000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', '{"size":4,"mimetype":"image/webp"}'::jsonb, now() - interval '72 hours'),
  ('profile-media', '10000000-0000-0000-0000-000000000001/avatar/bb000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001', '{"size":4,"mimetype":"image/webp"}'::jsonb, now() - interval '72 hours'),
  ('profile-media', '10000000-0000-0000-0000-000000000001/avatar/bb000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001', '{"size":4,"mimetype":"image/webp"}'::jsonb, now());

update public.profiles
set avatar_path = '10000000-0000-0000-0000-000000000001/avatar/bb000000-0000-0000-0000-000000000001'
where auth_user_id = '10000000-0000-0000-0000-000000000001';

-- 앞선 워커 왕복이 남긴 첨부 object도 참조가 끊긴 상태라 함께 후보가 된다. 실제 운영에서는
-- Storage API가 그것들을 이미 지웠겠지만, 테스트에서는 storage.objects를 직접 지울 수 없다
-- (`storage.protect_delete`). 그래서 총계가 아니라 이 프로필 이미지가 어떻게 다뤄지는지를 본다.
select ok(
  private.sweep_unreferenced_storage_objects(p_dry_run => true) > 0,
  'the sweep finds unreferenced objects outside the grace window'
);
select ok(
  exists (
    select 1 from private.storage_cleanup_queue
    where object_path like '%bb000000-0000-0000-0000-000000000002'
      and reason = 'unreferenced_sweep'
  ),
  'the unreferenced profile image is one of them'
);
select ok(
  not exists (
    select 1 from private.storage_cleanup_queue
    where object_path like '%bb000000-0000-0000-0000-000000000001'
  ),
  'the object a profile slot points at is never swept'
);
select ok(
  not exists (
    select 1 from private.storage_cleanup_queue
    where object_path like '%bb000000-0000-0000-0000-000000000003'
  ),
  'an object uploaded within the last 48 hours is never swept'
);
select is(
  (
    select dry_run from private.storage_cleanup_queue
    where object_path like '%bb000000-0000-0000-0000-000000000002'
  ),
  true,
  'a dry-run sweep only records the candidate'
);
select is(
  (select count(*) from private.claim_storage_cleanup(100, 300)),
  0::bigint,
  'the worker never picks up a dry-run candidate'
);
select ok(
  private.sweep_unreferenced_storage_objects(p_dry_run => false) > 0,
  'a live sweep re-reports the same candidates'
);
select is(
  (
    select dry_run from private.storage_cleanup_queue
    where object_path like '%bb000000-0000-0000-0000-000000000002'
  ),
  false,
  'turning the sweep live promotes the recorded candidate'
);

-- 프로필 이미지는 슬롯에서 내려와도 변경 활동 게시물이 살아 있는 동안에는 남는다.
insert into public.profile_media_objects (
  id, profile_id, auth_user_id, slot, object_path, size_bytes, width, height,
  status, ready_at
)
select
  'cc000000-0000-0000-0000-000000000001',
  profile.id,
  profile.auth_user_id,
  'avatar',
  profile.auth_user_id::text || '/avatar/cc000000-0000-0000-0000-000000000001',
  4, 100, 100, 'ready', now()
from public.profiles as profile
where profile.auth_user_id = '10000000-0000-0000-0000-000000000001';

insert into public.posts (
  id, kind, body, timeline_profile_id, author_identity,
  display_author_profile_id, visibility, published_at,
  activity_kind, activity_media_path
)
select
  'dd000000-0000-0000-0000-000000000001', 'profile', '', profile.id,
  'identified', profile.id, 'public', now(), 'avatar_changed',
  profile.auth_user_id::text || '/avatar/cc000000-0000-0000-0000-000000000001'
from public.profiles as profile
where profile.auth_user_id = '10000000-0000-0000-0000-000000000001';

select is(
  private.enqueue_storage_cleanup(),
  0::bigint,
  'an unslotted profile image stays while its activity post is alive'
);
update public.posts set deleted_at = now()
where id = 'dd000000-0000-0000-0000-000000000001';
select is(
  private.enqueue_storage_cleanup(),
  1::bigint,
  'deleting the last activity post releases the old profile image'
);
select ok(
  exists (
    select 1 from private.storage_cleanup_queue
    where object_path like '%cc000000-0000-0000-0000-000000000001'
      and reason = 'profile_media'
      and not dry_run
  ),
  'the released profile image is queued for real deletion'
);

select * from finish();
rollback;
