-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION private.invoke_storage_cleanup();

CREATE OR REPLACE FUNCTION private.claim_storage_cleanup (
  p_limit         integer DEFAULT 100,
  p_lease_seconds integer DEFAULT 300
)
  RETURNS TABLE (
    id          uuid,
    bucket      text,
    object_path text,
    lease_id    uuid
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION private.complete_storage_cleanup (
  p_lease_id    uuid,
  p_ids         uuid[],
  p_removed_ids uuid[] DEFAULT '{}'::uuid[],
  p_error       text   DEFAULT NULL::text
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_storage_cleanup()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  enqueued bigint := 0;
  moved bigint;
begin
  -- Upload preparation and commits lock the parent too. Taking the same lock first prevents a new
  -- attachment from appearing after path capture but before the stale draft is deleted.
  perform 1
  from public.posts as post
  where post.published_at is null
    and post.created_at <= now() - interval '48 hours'
  for update;

  with expired as (
    delete from public.post_attachments as attachment
    where attachment.status = 'deleted'
      or (
        attachment.status = 'pending'
        and attachment.created_at <= now() - interval '48 hours'
      )
      or exists (
        select 1
        from public.posts as post
        where post.id = attachment.post_id
          and post.published_at is null
          and post.created_at <= now() - interval '48 hours'
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

  -- Attachments are removed and queued first so deleting the parent cannot cascade away the only
  -- copy of a ready object's path. Draft-row deletion is deliberately not included in `enqueued`.
  delete from public.posts as post
  where post.published_at is null
    and post.created_at <= now() - interval '48 hours';

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
$function$;

CREATE FUNCTION private.invoke_storage_cleanup (
  p_quiet boolean DEFAULT false
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  project_url text;
  cleanup_secret text;
  request_id bigint;
begin
  -- 가져갈 것이 없으면 부르지 않는다. 백스톱이 자주 돌아도 빈 실행 기록이 쌓이지 않아, 관리자
  -- 화면의 "마지막 실행"이 실제로 무언가를 처리한 실행을 가리킨다.
  if not exists (
    select 1
    from private.storage_cleanup_queue as queue
    where not queue.dry_run and queue.next_attempt_at <= now()
  ) then
    return null;
  end if;

  -- 진행 중인 실행이 있으면 겹쳐 부르지 않는다. 게시물을 잇달아 지워도 호출은 한 번이면 된다.
  if exists (
    select 1
    from private.storage_cleanup_runs as run
    where run.finished_at is null and run.started_at > now() - interval '2 minutes'
  ) then
    return null;
  end if;

  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'project_url';

  select decrypted_secret into cleanup_secret
  from vault.decrypted_secrets
  where name = 'storage_cleanup_secret';

  if project_url is null or cleanup_secret is null then
    if p_quiet then
      return null;
    end if;
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
exception
  when others then
    -- 조용한 호출은 어떤 실패도 밖으로 내보내지 않는다. 이 블록은 하위 트랜잭션이라 여기서
    -- 되감기면 위에서 건 pg_net 요청도 함께 사라진다.
    if p_quiet then
      return null;
    end if;
    raise;
end;
$function$;

REVOKE ALL ON FUNCTION private.invoke_storage_cleanup(boolean) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.reconcile_storage_cleanup_runs()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION private.storage_cleanup_response_field (
  p_content_type text,
  p_content      text,
  p_key          text
)
  RETURNS integer
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION private.sweep_unreferenced_storage_objects (
  p_dry_run boolean DEFAULT true,
  p_limit   integer DEFAULT 1000
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_storage_cleanup_status()
  RETURNS TABLE (
    secrets_configured       boolean,
    queue_pending            integer,
    queue_retrying           integer,
    queue_dry_run            integer,
    queue_oldest_enqueued_at timestamp with time zone,
    last_run_started_at      timestamp with time zone,
    last_run_finished_at     timestamp with time zone,
    last_run_status_code     integer,
    last_run_removed         integer,
    last_run_failed          integer,
    last_run_error           text,
    last_cron_status         text,
    last_cron_at             timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
    where job.jobname = 'drain-storage-cleanup-hourly'
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
$function$;

CREATE OR REPLACE FUNCTION public.claim_storage_cleanup (
  p_limit         integer DEFAULT 100,
  p_lease_seconds integer DEFAULT 300
)
  RETURNS TABLE (
    id          uuid,
    bucket      text,
    object_path text,
    lease_id    uuid
  )
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  select * from private.claim_storage_cleanup(p_limit, p_lease_seconds);
$function$;

CREATE OR REPLACE FUNCTION public.complete_storage_cleanup (
  p_lease_id    uuid,
  p_ids         uuid[],
  p_removed_ids uuid[] DEFAULT '{}'::uuid[],
  p_error       text   DEFAULT NULL::text
)
  RETURNS integer
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  select private.complete_storage_cleanup(p_lease_id, p_ids, p_removed_ids, p_error);
$function$;
-- 예약 작업은 스키마 diff가 잡지 못하므로 직접 적는다.
--
-- 드레인은 이제 주 경로가 아니다. 삭제 RPC가 커밋 직후 워커를 깨우므로 대부분의 파일은 예약
-- 실행을 기다리지 않는다. 이 잡은 깨우기가 실패했거나 한 번에 가져가는 100건 한도에 걸려 남은
-- 분량을 회수하는 백스톱이다(삭제 및 보존 정책 §6). 큐가 비면 함수가 곧바로 빠져나오므로
-- 매시간 돌아도 빈 실행 기록이 쌓이지 않는다. 1층 적재(03:17)는 03:47 실행이 그대로 받는다.
select cron.unschedule(jobid)
from cron.job
where jobname = 'drain-storage-cleanup-daily';

select cron.schedule(
  'drain-storage-cleanup-hourly',
  '47 * * * *',
  'select private.invoke_storage_cleanup()'
);
