-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.

-- Storage 고아 object 정리. 두 층으로 나뉘고 두 층이 같은 큐에 쌓는다.
--
--   1층 행 수명주기: 첨부·미디어 행이 수명을 다하면 그 행을 지우면서 object 경로를 큐로 옮긴다.
--     행이 남아 있다는 것이 곧 "이 object는 살아 있다"는 뜻이 되므로, 2층이 볼 참조 집합과
--     1층이 지울 대상이 같은 사실 하나에서 나온다.
--   2층 object 스윕: 어떤 행도 참조하지 않는 object를 storage.objects에서 직접 찾아 큐에 넣는다.
--     1층이 모든 버킷을 덮고 있어도 행 자체가 없는 object는 원리적으로 1층이 볼 수 없다. 2층은
--     그 경우와 미래의 버그를 받는 안전망이다.
--
-- 실제 삭제는 Edge Function이 Storage API로 한다. storage.objects 행만 지우면 S3 파일이 남는다.

create table if not exists private.storage_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  object_path text not null,
  reason text not null,
  -- 스윕을 처음 켤 때는 지우지 않고 후보만 쌓는다. 참조 정의를 하나라도 빠뜨리면 살아 있는
  -- 이미지를 지우므로, 관리자 화면에서 후보를 눈으로 확인한 뒤 끄는 스위치다.
  dry_run boolean not null default false,
  attempts integer not null default 0,
  last_error text,
  enqueued_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  lease_expires_at timestamptz,
  constraint storage_cleanup_queue_object_key unique (bucket, object_path),
  constraint storage_cleanup_queue_reason_check check (
    reason in (
      'post_attachment',
      'comment_image',
      'group_media',
      'profile_media',
      'unreferenced_sweep'
    )
  ),
  constraint storage_cleanup_queue_lease_check check (
    (lease_id is null) = (lease_expires_at is null)
  )
);
alter table private.storage_cleanup_queue owner to postgres;

create index if not exists storage_cleanup_queue_ready_idx
  on private.storage_cleanup_queue (next_attempt_at, enqueued_at, id)
  where not dry_run;

-- 실행 기록. 예전 구현은 실패가 함수 로그에만 남아, 정리가 한 번도 돌지 않은 것을 아무도 알 수
-- 없었다. pg_net은 비동기라 요청 시점에는 결과를 모르므로 request_id만 남기고 나중에 맞춘다.
create table if not exists private.storage_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  request_id bigint,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status_code integer,
  claimed integer,
  removed integer,
  failed integer,
  error text
);
alter table private.storage_cleanup_runs owner to postgres;

create index if not exists storage_cleanup_runs_started_idx
  on private.storage_cleanup_runs (started_at desc);

alter table private.storage_cleanup_queue enable row level security;
alter table private.storage_cleanup_runs enable row level security;

-- 살아 있는 object의 단일 정의. 2층 스윕은 이 집합의 여집합만 지우므로, 버킷을 추가하면서
-- 여기에 참조를 더하지 않으면 그 버킷의 파일이 전부 삭제 후보가 된다. 새 버킷은 반드시 같은
-- 변경에서 이 뷰와 pgTAP 테스트에 함께 들어간다.
create or replace view private.referenced_storage_objects as
-- 소프트 삭제된 프로필도 참조로 친다. 탈퇴는 아직 구현되어 있지 않아 `profiles.deleted_at`을
-- 세우는 경로가 없고, 여기에서 상태로 거르면 되돌릴 수 있는 상태의 사용자 이미지를 지울 위험만
-- 생긴다. 탈퇴를 구현할 때 그 RPC가 자기 미디어를 직접 큐에 넣어야 한다 (STORAGE_BUCKETS §4.1).
select 'profile-media'::text as bucket, profile.avatar_path as object_path
from public.profiles as profile
where profile.avatar_path is not null
union all
select 'profile-media'::text, profile.cover_path
from public.profiles as profile
where profile.cover_path is not null
union all
-- 프로필 변경 활동 게시물은 교체 당시의 이미지를 계속 가리킨다. 슬롯에서 내려온 과거 이미지도
-- 그 게시물이 살아 있는 동안에는 참조된 상태다.
select 'profile-media'::text, post.activity_media_path
from public.posts as post
where post.activity_media_path is not null
  and post.deleted_at is null
union all
select 'profile-media'::text, media.object_path
from public.profile_media_objects as media
union all
select attachment.storage_bucket, attachment.object_path
from public.post_attachments as attachment
union all
select image.storage_bucket, image.object_path
from public.comment_images as image
union all
select 'group-media'::text, media.object_path
from public.group_media_objects as media;
alter view private.referenced_storage_objects owner to postgres;

-- 1층. 수명을 다한 행을 지우면서 경로를 큐로 옮긴다. 행 삭제와 큐 적재가 한 문장이라 경로를
-- 잃고 object만 남는 순간이 없다.
create or replace function private.enqueue_storage_cleanup()
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  enqueued bigint := 0;
  moved bigint;
begin
  with expired as (
    delete from public.post_attachments as attachment
    where attachment.status = 'deleted'
      or (
        attachment.status = 'pending'
        and attachment.created_at <= now() - interval '48 hours'
      )
    returning attachment.storage_bucket as bucket, attachment.object_path as object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select expired.bucket, expired.object_path, 'post_attachment'
  from expired
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics moved = row_count;
  enqueued := enqueued + moved;

  with expired as (
    delete from public.comment_images as image
    where image.status = 'deleted'
      or (
        image.status in ('pending', 'finalized')
        and image.created_at <= now() - interval '48 hours'
      )
    returning image.storage_bucket as bucket, image.object_path as object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select expired.bucket, expired.object_path, 'comment_image'
  from expired
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics moved = row_count;
  enqueued := enqueued + moved;

  with expired as (
    delete from public.group_media_objects as media
    where media.status = 'deleted'
      or (
        media.status = 'pending'
        and media.created_at <= now() - interval '48 hours'
      )
    returning media.object_path as object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'group-media', expired.object_path, 'group_media'
  from expired
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics moved = row_count;
  enqueued := enqueued + moved;

  -- 프로필 이미지만 조건이 상태가 아니라 참조다. 슬롯에서 내려와도 변경 활동 게시물이 살아
  -- 있는 동안에는 남고, 그 게시물이 삭제된 뒤에야 지울 수 있다.
  with expired as (
    delete from public.profile_media_objects as media
    where (
        media.status = 'pending'
        and media.created_at <= now() - interval '48 hours'
      )
      or (
        media.status = 'ready'
        and not exists (
          select 1
          from public.profiles as profile
          where media.object_path in (profile.avatar_path, profile.cover_path)
        )
        and not exists (
          select 1
          from public.posts as post
          where post.activity_media_path = media.object_path
            and post.deleted_at is null
        )
      )
    returning media.object_path as object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'profile-media', expired.object_path, 'profile_media'
  from expired
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics moved = row_count;
  enqueued := enqueued + moved;

  return enqueued;
end;
$$;
alter function private.enqueue_storage_cleanup() owner to postgres;

-- 2층. 업로드 직후 finalize를 기다리는 object를 지우지 않도록 storage.objects의 생성 시각으로
-- 유예를 준다. 1층이 쓰는 48시간과 같은 값이다.
create or replace function private.sweep_unreferenced_storage_objects(
  p_dry_run boolean default true,
  p_limit integer default 1000
)
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  enqueued bigint;
begin
  if p_limit not between 1 and 10000 then
    raise exception 'invalid sweep limit' using errcode = '22023';
  end if;

  with unreferenced as (
    select object.bucket_id as bucket, object.name as object_path
    from storage.objects as object
    where object.bucket_id in ('profile-media', 'group-media', 'post-attachments')
      and object.created_at <= now() - interval '48 hours'
      and not coalesce(object.is_delete_marker, false)
      and not exists (
        select 1
        from private.referenced_storage_objects as reference
        where reference.bucket = object.bucket_id
          and reference.object_path = object.name
      )
    order by object.created_at
    limit p_limit
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason, dry_run)
  select
    unreferenced.bucket,
    unreferenced.object_path,
    'unreferenced_sweep',
    coalesce(p_dry_run, true)
  from unreferenced
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics enqueued = row_count;

  return enqueued;
end;
$$;
alter function private.sweep_unreferenced_storage_objects(boolean, integer) owner to postgres;

-- 한 번의 호출이 받은 항목 전체에 같은 리스를 준다. 워커는 버킷별로 묶어 한 번에 지우므로
-- 완료 보고도 배치 단위다.
create or replace function private.claim_storage_cleanup(
  p_limit integer default 100,
  p_lease_seconds integer default 300
)
returns table (id uuid, bucket text, object_path text, lease_id uuid)
language plpgsql security definer
set search_path = ''
as $$
declare
  lease uuid := gen_random_uuid();
begin
  if p_limit not between 1 and 500 or p_lease_seconds not between 30 and 3600 then
    raise exception 'invalid cleanup lease parameters' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select queue.id
    from private.storage_cleanup_queue as queue
    where not queue.dry_run
      and queue.next_attempt_at <= now()
      and (queue.lease_expires_at is null or queue.lease_expires_at <= now())
    order by queue.next_attempt_at, queue.enqueued_at, queue.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update private.storage_cleanup_queue as queue
    set lease_id = lease,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    from candidates
    where queue.id = candidates.id
    returning queue.id, queue.bucket, queue.object_path
  )
  select claimed.id, claimed.bucket, claimed.object_path, lease
  from claimed;
end;
$$;
alter function private.claim_storage_cleanup(integer, integer) owner to postgres;

-- 워커는 배치 하나를 Storage API 한 번으로 지우지만, 그 응답은 **실제로 지운 경로만** 담고
-- 없는 경로에는 오류를 내지 않는다. 그래서 배치 전체를 성공/실패로 뭉뚱그리면 안 된다.
--   - 응답에 담긴 것: 지워졌다.
--   - 응답에 없지만 storage.objects에도 없는 것: 이미 없었다. 재시도해도 영원히 응답에 담기지
--     않으므로 완료로 처리하지 않으면 큐에서 빠져나갈 길이 없다.
--   - 둘 다 아닌 것: 진짜 실패. 큐에 남기고 백오프한다.
-- 판단에 필요한 사실이 전부 데이터베이스에 있으므로 워커가 아니라 여기에서 가른다.
create or replace function private.complete_storage_cleanup(
  p_lease_id uuid,
  p_ids uuid[],
  p_removed_ids uuid[] default '{}',
  p_error text default null
)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  completed integer;
begin
  if p_lease_id is null or p_ids is null then
    raise exception 'invalid cleanup completion parameters' using errcode = '22023';
  end if;

  delete from private.storage_cleanup_queue as queue
  where queue.id = any(p_ids)
    and queue.lease_id = p_lease_id
    and queue.lease_expires_at > now()
    and (
      queue.id = any(coalesce(p_removed_ids, '{}'::uuid[]))
      or not exists (
        select 1
        from storage.objects as object
        where object.bucket_id = queue.bucket
          and object.name = queue.object_path
      )
    );
  get diagnostics completed = row_count;

  -- 남은 것은 실제로 지워지지 않았다. 지수 백오프로 미루고 리스를 풀어 다음 실행이 다시
  -- 가져갈 수 있게 한다. attempts는 증가 전 값이라 첫 실패가 1분, 이후 2·4·8분으로 벌어지고
  -- 하루에서 멈춘다.
  update private.storage_cleanup_queue
  set attempts = attempts + 1,
    last_error = left(p_error, 500),
    lease_id = null,
    lease_expires_at = null,
    next_attempt_at = now() + least(
      make_interval(mins => (2 ^ least(attempts, 11))::integer),
      interval '24 hours'
    )
  where id = any(p_ids)
    and lease_id = p_lease_id;

  return completed;
end;
$$;
alter function private.complete_storage_cleanup(uuid, uuid[], uuid[], text) owner to postgres;

-- PostgREST는 public만 노출하므로 워커용 래퍼를 둔다. private 스키마 자체는 열지 않는다.
create or replace function public.claim_storage_cleanup(
  p_limit integer default 100,
  p_lease_seconds integer default 300
)
returns table (id uuid, bucket text, object_path text, lease_id uuid)
language sql security invoker
set search_path = ''
as $$
  select * from private.claim_storage_cleanup(p_limit, p_lease_seconds);
$$;
alter function public.claim_storage_cleanup(integer, integer) owner to postgres;

create or replace function public.complete_storage_cleanup(
  p_lease_id uuid,
  p_ids uuid[],
  p_removed_ids uuid[] default '{}',
  p_error text default null
)
returns integer
language sql security invoker
set search_path = ''
as $$
  select private.complete_storage_cleanup(p_lease_id, p_ids, p_removed_ids, p_error);
$$;
alter function public.complete_storage_cleanup(uuid, uuid[], uuid[], text) owner to postgres;

-- 설정이 없으면 예외를 던진다. 예전 구현은 null을 반환하고 끝나 cron이 성공으로 기록했고,
-- 그래서 정리가 도는지 여부를 어디에서도 확인할 수 없었다. 관리자 화면은 이 실패를 시크릿
-- 존재 여부로 직접 보여 준다.
create or replace function private.invoke_storage_cleanup()
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  project_url text;
  cleanup_secret text;
  request_id bigint;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'project_url';

  select decrypted_secret into cleanup_secret
  from vault.decrypted_secrets
  where name = 'storage_cleanup_secret';

  if project_url is null or cleanup_secret is null then
    raise exception 'storage cleanup vault configuration is missing'
      using errcode = '55000';
  end if;

  select net.http_post(
    url := project_url || '/functions/v1/cleanup-storage-objects',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-secret', cleanup_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into request_id;

  insert into private.storage_cleanup_runs (request_id) values (request_id);
  return request_id;
end;
$$;
alter function private.invoke_storage_cleanup() owner to postgres;

-- 워커 응답 본문에서 숫자 하나를 꺼낸다. 본문이 JSON이 아니거나(401 "Unauthorized" 같은) 키가
-- 없으면 -1을 돌려주고 호출부가 null로 바꾼다.
create or replace function private.storage_cleanup_response_field(
  p_content_type text,
  p_content text,
  p_key text
)
returns integer
language plpgsql immutable
set search_path = ''
as $$
declare
  parsed jsonb;
begin
  if p_content is null or coalesce(p_content_type, '') not like 'application/json%' then
    return -1;
  end if;
  parsed := p_content::jsonb;
  return coalesce((parsed ->> p_key)::integer, -1);
exception when others then
  return -1;
end;
$$;
alter function private.storage_cleanup_response_field(text, text, text) owner to postgres;

-- pg_net은 응답을 별도 테이블에 비동기로 적고 몇 시간 뒤 스스로 지운다. 그 전에 실행 기록과
-- 맞춰 두지 않으면 결과를 영영 잃는다.
create or replace function private.reconcile_storage_cleanup_runs()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  update private.storage_cleanup_runs as run
  set finished_at = response.created,
    status_code = response.status_code,
    error = nullif(coalesce(response.error_msg, ''), ''),
    claimed = nullif(private.storage_cleanup_response_field(response.content_type, response.content, 'claimed'), -1),
    removed = nullif(private.storage_cleanup_response_field(response.content_type, response.content, 'removed'), -1),
    failed = nullif(private.storage_cleanup_response_field(response.content_type, response.content, 'failed'), -1)
  from net._http_response as response
  where response.id = run.request_id
    and run.finished_at is null;
  get diagnostics affected = row_count;

  -- 응답 행이 정리된 뒤에도 열려 있는 기록은 결과를 알 수 없다. 영원히 "실행 중"으로 남겨
  -- 화면을 오해하게 두지 않는다.
  update private.storage_cleanup_runs
  set finished_at = now(),
    error = coalesce(error, 'response expired before reconciliation')
  where finished_at is null
    and started_at <= now() - interval '6 hours';

  delete from private.storage_cleanup_runs
  where started_at < now() - interval '30 days';

  return affected;
end;
$$;
alter function private.reconcile_storage_cleanup_runs() owner to postgres;

-- 관리자 화면용 한 행 요약. 시크릿 존재 여부를 함께 돌려주므로 "설정이 없어 한 번도 돌지 않는
-- 상태"가 화면에서 바로 보인다.
create or replace function public.admin_storage_cleanup_status()
returns table (
  secrets_configured boolean,
  queue_pending integer,
  queue_retrying integer,
  queue_dry_run integer,
  queue_oldest_enqueued_at timestamptz,
  last_run_started_at timestamptz,
  last_run_finished_at timestamptz,
  last_run_status_code integer,
  last_run_removed integer,
  last_run_failed integer,
  last_run_error text,
  last_cron_status text,
  last_cron_at timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.require_app_admin();

  return query
  with queue_summary as (
    select
      count(*) filter (where not queue.dry_run)::integer as pending,
      count(*) filter (where not queue.dry_run and queue.attempts > 0)::integer as retrying,
      count(*) filter (where queue.dry_run)::integer as dry_run,
      min(queue.enqueued_at) filter (where not queue.dry_run) as oldest
    from private.storage_cleanup_queue as queue
  ), last_run as (
    select run.*
    from private.storage_cleanup_runs as run
    order by run.started_at desc
    limit 1
  ), last_cron as (
    select detail.status, detail.start_time
    from cron.job_run_details as detail
    join cron.job as job on job.jobid = detail.jobid
    where job.jobname = 'drain-storage-cleanup-daily'
    order by detail.start_time desc
    limit 1
  )
  select
    (
      exists (select 1 from vault.decrypted_secrets where name = 'project_url')
      and exists (select 1 from vault.decrypted_secrets where name = 'storage_cleanup_secret')
    ),
    queue_summary.pending,
    queue_summary.retrying,
    queue_summary.dry_run,
    queue_summary.oldest,
    last_run.started_at,
    last_run.finished_at,
    last_run.status_code,
    last_run.removed,
    last_run.failed,
    last_run.error,
    last_cron.status,
    last_cron.start_time
  from queue_summary
  left join last_run on true
  left join last_cron on true;
end;
$$;
alter function public.admin_storage_cleanup_status() owner to postgres;

revoke all on table private.storage_cleanup_queue from anon, authenticated;
revoke all on table private.storage_cleanup_runs from anon, authenticated;

revoke all on function private.enqueue_storage_cleanup() from public;
revoke all on function private.sweep_unreferenced_storage_objects(boolean, integer) from public;
revoke all on function private.claim_storage_cleanup(integer, integer) from public;
revoke all on function private.complete_storage_cleanup(uuid, uuid[], uuid[], text) from public;
revoke all on function private.invoke_storage_cleanup() from public;
revoke all on function private.reconcile_storage_cleanup_runs() from public;
revoke all on function private.storage_cleanup_response_field(text, text, text) from public;

grant execute on function private.claim_storage_cleanup(integer, integer) to service_role;
grant execute on function private.complete_storage_cleanup(uuid, uuid[], uuid[], text) to service_role;

revoke all on function public.claim_storage_cleanup(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_storage_cleanup(integer, integer) to service_role;
revoke all on function public.complete_storage_cleanup(uuid, uuid[], uuid[], text) from public, anon, authenticated;
grant execute on function public.complete_storage_cleanup(uuid, uuid[], uuid[], text) to service_role;

revoke all on function public.admin_storage_cleanup_status() from public;
grant execute on function public.admin_storage_cleanup_status() to authenticated;
