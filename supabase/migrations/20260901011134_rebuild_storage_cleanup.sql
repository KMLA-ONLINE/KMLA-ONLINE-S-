-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

-- 아래 DROP FUNCTION보다 먼저 와야 한다. 두 정책이 그 함수들에 의존한다.
-- storage.objects 정책은 public,private 덤프에 포함되지 않는다.
-- 업로드는 경로 모양이 아니라 prepare가 만든 `pending` 행에만 허용하고, 클라이언트 삭제는
-- 없앤다. object의 수명은 전적으로 정리 큐가 쥔다.
drop policy if exists "profile_media_delete_own" on storage.objects;
drop policy if exists "profile_media_insert_own" on storage.objects;


DROP FUNCTION private.can_delete_own_profile_media_path(p_object_path text);

DROP FUNCTION private.claim_comment_image_cleanup(IN p_limit integer, IN p_lease_seconds integer);

DROP FUNCTION private.claim_group_media_cleanup(IN p_limit integer, IN p_lease_seconds integer);

DROP FUNCTION private.claim_post_attachment_cleanup(IN p_limit integer, IN p_lease_seconds integer);

DROP FUNCTION private.complete_comment_image_cleanup(p_image_id uuid, p_lease_id uuid, p_object_deleted boolean);

DROP FUNCTION private.complete_group_media_cleanup(p_media_id uuid, p_lease_id uuid, p_object_deleted boolean);

DROP FUNCTION private.complete_post_attachment_cleanup(p_attachment_id uuid, p_lease_id uuid, p_object_deleted boolean);

DROP FUNCTION private.invoke_post_attachment_cleanup();

DROP FUNCTION private.is_own_profile_media_path(p_object_path text);

DROP FUNCTION public.claim_group_media_cleanup(IN p_limit integer, IN p_lease_seconds integer);

DROP FUNCTION public.claim_post_attachment_cleanup(IN p_limit integer, IN p_lease_seconds integer);

DROP FUNCTION public.complete_group_media_cleanup(p_media_id uuid, p_lease_id uuid, p_object_deleted boolean);

DROP FUNCTION public.complete_post_attachment_cleanup(p_attachment_id uuid, p_lease_id uuid, p_object_deleted boolean);

DROP FUNCTION public.set_my_profile_media(p_slot text, p_object_path text);

ALTER TABLE public.comment_images
  DROP CONSTRAINT comment_images_cleanup_lease_check;

ALTER TABLE public.comment_images
  DROP COLUMN cleanup_lease_expires_at;

ALTER TABLE public.comment_images
  DROP COLUMN cleanup_lease_id;

ALTER TABLE public.group_media_objects
  DROP CONSTRAINT group_media_cleanup_lease_check;

ALTER TABLE public.group_media_objects
  DROP COLUMN cleanup_lease_expires_at;

ALTER TABLE public.group_media_objects
  DROP COLUMN cleanup_lease_id;

ALTER TABLE public.post_attachments
  DROP CONSTRAINT post_attachments_cleanup_lease_check;

ALTER TABLE public.post_attachments
  DROP COLUMN cleanup_lease_expires_at;

ALTER TABLE public.post_attachments
  DROP COLUMN cleanup_lease_id;

CREATE OR REPLACE FUNCTION private.apply_post_commit (
  p_post_id        uuid,
  p_body           text,
  p_attachment_ids uuid[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  attachment_count integer := cardinality(coalesce(p_attachment_ids, '{}'::uuid[]));
begin
  if char_length(coalesce(p_body, '')) > 20000 then
    raise exception 'body must contain between 0 and 20000 characters' using errcode = '22023';
  end if;
  if attachment_count > 10
    or attachment_count <> (
      select count(distinct attachment_id)
      from unnest(coalesce(p_attachment_ids, '{}'::uuid[])) as attachment_id
    ) then
    raise exception 'attachment order must contain at most 10 unique ids' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_attachment_ids, '{}'::uuid[])) as requested(id)
    where not exists (
      select 1 from public.post_attachments as attachment
      where attachment.id = requested.id
        and attachment.post_id = p_post_id
        and attachment.status <> 'deleted'
    )
  ) then
    raise exception 'attachment does not belong to this post' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.post_attachments as attachment
    left join storage.objects as object
      on object.bucket_id = attachment.storage_bucket
      and object.name = attachment.object_path
    where attachment.id = any(coalesce(p_attachment_ids, '{}'::uuid[]))
      and attachment.status = 'pending'
      and (
        object.id is null
        or object.owner_id is distinct from auth.uid()::text
        or nullif(object.metadata ->> 'size', '')::bigint is distinct from attachment.size_bytes
        or object.metadata ->> 'mimetype' is distinct from attachment.mime_type
      )
  ) then
    raise exception 'uploaded attachment metadata does not match' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null and attachment_count = 0 then
    raise exception 'post requires a body or ready attachment' using errcode = '22023';
  end if;

  update public.post_attachments
  set status = 'deleted', deleted_at = now()
  where post_id = p_post_id
    and status <> 'deleted'
    and not (id = any(coalesce(p_attachment_ids, '{}'::uuid[])));

  -- 순서를 음수로 밀어 두고 다시 매긴다. `(post_id, position)` unique 제약을 중간 상태에서
  -- 밟지 않기 위한 것이다.
  update public.post_attachments
  set position = -position - 1
  where post_id = p_post_id and status <> 'deleted';

  update public.post_attachments as attachment
  set position = requested.ordinality - 1,
    status = 'ready',
    ready_at = coalesce(attachment.ready_at, now())
  from unnest(coalesce(p_attachment_ids, '{}'::uuid[]))
    with ordinality as requested(id, ordinality)
  where attachment.id = requested.id;
end;
$function$;

CREATE FUNCTION private.can_upload_profile_media (
  p_object_path text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.profile_media_objects as media
    join public.profiles as profile on profile.id = media.profile_id
    where media.object_path = p_object_path
      and media.status = 'pending'
      and profile.auth_user_id = auth.uid()
      and profile.status = 'accepted'
      and profile.deleted_at is null
  );
$function$;

REVOKE ALL ON FUNCTION private.can_upload_profile_media(text) FROM PUBLIC;

GRANT ALL ON FUNCTION private.can_upload_profile_media(text) TO authenticated;

CREATE FUNCTION private.claim_storage_cleanup (
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

REVOKE ALL ON FUNCTION private.claim_storage_cleanup(integer, integer) FROM PUBLIC;

GRANT ALL ON FUNCTION private.claim_storage_cleanup(integer, integer) TO service_role;

CREATE FUNCTION private.complete_storage_cleanup (
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

REVOKE ALL ON FUNCTION private.complete_storage_cleanup(uuid, uuid[], uuid[], text) FROM PUBLIC;

GRANT ALL ON FUNCTION private.complete_storage_cleanup(uuid, uuid[], uuid[], text) TO service_role;

CREATE FUNCTION private.enqueue_storage_cleanup()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION private.enqueue_storage_cleanup() FROM PUBLIC;

CREATE FUNCTION private.invoke_storage_cleanup()
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
$function$;

REVOKE ALL ON FUNCTION private.invoke_storage_cleanup() FROM PUBLIC;

CREATE FUNCTION private.reconcile_storage_cleanup_runs()
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

REVOKE ALL ON FUNCTION private.reconcile_storage_cleanup_runs() FROM PUBLIC;

CREATE FUNCTION private.storage_cleanup_response_field (
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

REVOKE ALL ON FUNCTION private.storage_cleanup_response_field(text, text, text) FROM PUBLIC;

CREATE FUNCTION private.sweep_unreferenced_storage_objects (
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

REVOKE ALL ON FUNCTION private.sweep_unreferenced_storage_objects(boolean, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.tombstone_comment_images()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  update public.comment_images
  set status = 'deleted', deleted_at = now()
  where comment_id = new.id and status = 'ready';
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.tombstone_post_comment_images()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  update public.comment_images
  set status = 'deleted', deleted_at = now()
  where post_id = new.id and status <> 'deleted';
  return null;
end;
$function$;

CREATE TABLE private.storage_cleanup_queue (
  id               uuid                     DEFAULT gen_random_uuid() NOT NULL,
  bucket           text                     NOT NULL,
  object_path      text                     NOT NULL,
  reason           text                     NOT NULL,
  dry_run          boolean                  DEFAULT false NOT NULL,
  attempts         integer                  DEFAULT 0 NOT NULL,
  last_error       text,
  enqueued_at      timestamp with time zone DEFAULT now() NOT NULL,
  next_attempt_at  timestamp with time zone DEFAULT now() NOT NULL,
  lease_id         uuid,
  lease_expires_at timestamp with time zone
);

ALTER TABLE private.storage_cleanup_queue
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE private.storage_cleanup_queue
  ADD CONSTRAINT storage_cleanup_queue_lease_check CHECK ((lease_id IS NULL) = (lease_expires_at IS NULL));

ALTER TABLE private.storage_cleanup_queue
  ADD CONSTRAINT storage_cleanup_queue_object_key UNIQUE (bucket, object_path);

ALTER TABLE private.storage_cleanup_queue
  ADD CONSTRAINT storage_cleanup_queue_pkey PRIMARY KEY (id);

ALTER TABLE private.storage_cleanup_queue
  ADD CONSTRAINT storage_cleanup_queue_reason_check
    CHECK (reason = ANY (ARRAY['post_attachment'::text, 'comment_image'::text, 'group_media'::text, 'profile_media'::text, 'unreferenced_sweep'::text]));

CREATE INDEX storage_cleanup_queue_ready_idx ON private.storage_cleanup_queue (next_attempt_at, enqueued_at, id)
  WHERE NOT dry_run;

CREATE TABLE private.storage_cleanup_runs (
  id          uuid                     DEFAULT gen_random_uuid() NOT NULL,
  request_id  bigint,
  started_at  timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone,
  status_code integer,
  claimed     integer,
  removed     integer,
  failed      integer,
  error       text
);

ALTER TABLE private.storage_cleanup_runs
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE private.storage_cleanup_runs
  ADD CONSTRAINT storage_cleanup_runs_pkey PRIMARY KEY (id);

CREATE INDEX storage_cleanup_runs_started_idx ON private.storage_cleanup_runs (started_at DESC);

CREATE TYPE public.profile_media_slot AS ENUM (
  'avatar',
  'cover'
);

CREATE TYPE public.profile_media_status AS ENUM (
  'pending',
  'ready'
);

CREATE FUNCTION public.admin_storage_cleanup_status()
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
$function$;

REVOKE ALL ON FUNCTION public.admin_storage_cleanup_status() FROM PUBLIC;

GRANT ALL ON FUNCTION public.admin_storage_cleanup_status() TO authenticated;

CREATE FUNCTION public.claim_storage_cleanup (
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

REVOKE ALL ON FUNCTION public.claim_storage_cleanup(integer, integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.claim_storage_cleanup(integer, integer) TO service_role;

CREATE FUNCTION public.complete_storage_cleanup (
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

REVOKE ALL ON FUNCTION public.complete_storage_cleanup(uuid, uuid[], uuid[], text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.complete_storage_cleanup(uuid, uuid[], uuid[], text) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_group_post (
  p_post_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
  caller_role public.group_member_role;
  author_profile_id bigint;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record from public.posts as post
  where post.id = p_post_id and post.kind = 'group' and post.deleted_at is null
  for update;
  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = post_record.group_id
    and membership.profile_id = caller_profile_id;
  if post_record.id is null or caller_role is null then
    raise exception 'post not found or not accessible' using errcode = '42501';
  end if;
  if caller_role not in ('owner', 'admin') and not private.is_post_author(p_post_id) then
    raise exception 'post deletion is not allowed' using errcode = '42501';
  end if;
  select author.profile_id into author_profile_id
  from private.post_authors as author where author.post_id = p_post_id;
  update public.posts set deleted_at = now(), pinned_at = null where id = p_post_id;
  update public.post_attachments
  set status = 'deleted', deleted_at = now()
  where post_id = p_post_id and status <> 'deleted';
  if caller_profile_id <> author_profile_id then
    -- 어느 글이 사라졌는지 제목으로 말해준다. 삭제된 게시물은 열어볼 수 없으므로 알림이
    -- 대상을 밝히지 않으면 작성자는 무엇이 지워졌는지 영영 알 수 없다. 제목은 작성자
    -- 본인이 쓴 값이고 새 그룹 게시물 알림이 이미 같은 값을 그대로 싣는다. 본문은 싣지
    -- 않는다 -- 알림 제목은 잠금 화면 Push 본문이 되므로 원문이 나가서는 안 된다.
    perform private.emit_notification(
      'post-moderated:' || p_post_id::text,
      author_profile_id, 'post_moderated', 'high', 'moderation', 'staff',
      caller_profile_id, '운영진', null,
      '“' || post_record.title || '” 게시물이 운영자에 의해 삭제되었습니다.',
      post_record.group_id
    );
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_group (
  p_group_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_group public.groups;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group owner required' using errcode = '42501';
  end if;

  select group_record.* into target_group
  from public.groups as group_record
  where group_record.id = p_group_id and group_record.deleted_at is null
  for update;
  if target_group.id is null then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  -- 공식 그룹은 일반 그룹 운영 권한과 분리한다. 앱 관리자는 소유자·멤버십과 무관하게 학교
  -- 공간을 정리할 수 있지만, 비공식 그룹은 계속 소유자만 지운다.
  if target_group.kind = 'official' then
    perform private.require_app_admin();
  elsif not exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = p_group_id
      and membership.profile_id = caller_profile_id
      and membership.role = 'owner'
  ) then
    raise exception 'group owner required' using errcode = '42501';
  end if;

  update public.groups
  set deleted_at = now(), icon_path = null, cover_path = null
  where id = p_group_id;

  -- 저장소를 돌려받는다. 청소 워커가 집어 갈 수 있게 tombstone만 찍고 객체는 건드리지 않는다.
  update public.group_media_objects
  set status = 'deleted', deleted_at = now()
  where group_id = p_group_id and status <> 'deleted';

  update public.post_attachments as attachment
  set status = 'deleted', deleted_at = now()
  where attachment.status <> 'deleted'
    and exists (
      select 1 from public.posts as post
      where post.id = attachment.post_id and post.group_id = p_group_id
    );

  update public.posts
  set deleted_at = now(), pinned_at = null
  where group_id = p_group_id and deleted_at is null;

  delete from public.group_join_requests where group_id = p_group_id;
  delete from public.group_memberships where group_id = p_group_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_post_attachment (
  p_attachment_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  attachment public.post_attachments;
begin
  select item.* into attachment from public.post_attachments as item
  where item.id = p_attachment_id for update;
  if attachment.id is null or not private.is_post_author(attachment.post_id) then
    raise exception 'only the author can delete attachments' using errcode = '42501';
  end if;
  if attachment.status = 'ready'
    and exists (
      select 1 from public.posts
      where id = attachment.post_id
        and published_at is not null
        and nullif(btrim(body), '') is null
    )
    and not exists (
      select 1 from public.post_attachments
      where post_id = attachment.post_id
        and id <> attachment.id
        and status = 'ready'
    ) then
    raise exception 'post requires a body or ready attachment' using errcode = '22023';
  end if;
  if attachment.status <> 'deleted' then
    update public.post_attachments
    set status = 'deleted', deleted_at = now()
    where id = p_attachment_id;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_profile_post (
  p_post_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
  author_profile_id bigint;
  caller_profile public.profiles;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id and post.kind = 'profile' and post.deleted_at is null
  for update;
  if post_record.id is null then
    raise exception 'post not found or not accessible' using errcode = '42501';
  end if;
  if not private.is_post_author(p_post_id)
    and post_record.timeline_profile_id <> caller_profile_id then
    raise exception 'post deletion is not allowed' using errcode = '42501';
  end if;

  select author.profile_id into author_profile_id
  from private.post_authors as author where author.post_id = p_post_id;
  select profile.* into caller_profile
  from public.profiles as profile where profile.id = caller_profile_id;

  update public.posts set deleted_at = now() where id = p_post_id;
  update public.post_attachments
  set status = 'deleted', deleted_at = now()
  where post_id = p_post_id and status <> 'deleted';
  if caller_profile_id = post_record.timeline_profile_id
    and caller_profile_id <> author_profile_id then
    perform private.emit_notification(
      'timeline-post-deleted:' || p_post_id::text,
      author_profile_id, 'timeline_post_deleted', 'normal', 'timeline', 'identified',
      caller_profile_id, caller_profile.name, caller_profile.avatar_path,
      '타임라인 게시물이 삭제되었습니다.',
      null, null, null, post_record.timeline_profile_id
    );
  end if;
end;
$function$;

CREATE FUNCTION public.finalize_profile_media (
  p_media_id uuid
)
  RETURNS public.profiles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id uuid := auth.uid();
  media public.profile_media_objects;
  object_record storage.objects;
  current_profile public.profiles;
  updated_profile public.profiles;
  activity_post_id uuid := gen_random_uuid();
  activity_kind public.profile_media_activity_kind;
begin
  select item.* into media
  from public.profile_media_objects as item
  where item.id = p_media_id
  for update;

  if media.id is null or media.auth_user_id is distinct from caller_id then
    raise exception 'profile media owner required' using errcode = '42501';
  end if;
  if media.status <> 'pending' then
    raise exception 'profile media is not pending' using errcode = '55000';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.id = media.profile_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
  for update;

  if current_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select object.* into object_record
  from storage.objects as object
  where object.bucket_id = 'profile-media'
    and object.name = media.object_path;

  if object_record.id is null then
    raise exception 'uploaded object not found' using errcode = 'P0002';
  end if;
  if object_record.owner_id is distinct from caller_id::text then
    raise exception 'uploaded object owner does not match' using errcode = '42501';
  end if;
  if nullif(object_record.metadata ->> 'size', '')::bigint is distinct from media.size_bytes
    or object_record.metadata ->> 'mimetype' is distinct from 'image/webp' then
    raise exception 'uploaded object metadata does not match' using errcode = '22023';
  end if;

  update public.profile_media_objects
  set status = 'ready', ready_at = now()
  where id = media.id;

  if media.slot = 'avatar' then
    activity_kind := 'avatar_changed';
    update public.profiles
    set avatar_path = media.object_path
    where id = current_profile.id
    returning * into updated_profile;
  else
    activity_kind := 'cover_changed';
    update public.profiles
    set cover_path = media.object_path
    where id = current_profile.id
    returning * into updated_profile;
  end if;

  insert into public.posts (
    id,
    kind,
    body,
    timeline_profile_id,
    author_identity,
    display_author_profile_id,
    visibility,
    published_at,
    activity_kind,
    activity_media_path
  ) values (
    activity_post_id,
    'profile',
    '',
    current_profile.id,
    'identified',
    current_profile.id,
    'public',
    now(),
    activity_kind,
    media.object_path
  );

  insert into private.post_authors (post_id, profile_id)
  values (activity_post_id, current_profile.id);

  return updated_profile;
end;
$function$;

REVOKE ALL ON FUNCTION public.finalize_profile_media(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.finalize_profile_media(uuid) TO authenticated;

CREATE FUNCTION public.prepare_profile_media (
  p_slot       public.profile_media_slot,
  p_size_bytes bigint,
  p_width      integer,
  p_height     integer
)
  RETURNS TABLE (
    media_id    uuid,
    object_path text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id uuid := auth.uid();
  owner_profile_id bigint;
  created_id uuid := gen_random_uuid();
begin
  select profile.id
  into owner_profile_id
  from public.profiles as profile
  where profile.auth_user_id = caller_id
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if owner_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  insert into public.profile_media_objects (
    id, profile_id, auth_user_id, slot, object_path, size_bytes, width, height
  ) values (
    created_id,
    owner_profile_id,
    caller_id,
    p_slot,
    caller_id::text || '/' || p_slot::text || '/' || created_id::text,
    p_size_bytes,
    p_width,
    p_height
  );

  return query select created_id,
    caller_id::text || '/' || p_slot::text || '/' || created_id::text;
end;
$function$;

REVOKE ALL ON FUNCTION public.prepare_profile_media(public.profile_media_slot, bigint, integer, integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.prepare_profile_media(public.profile_media_slot, bigint, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_post_comment (
  p_comment_id   uuid,
  p_body         text,
  p_image_id     uuid    DEFAULT NULL::uuid,
  p_remove_image boolean DEFAULT false
)
  RETURNS TABLE (
    comment_id                              uuid,
    post_id                                 uuid,
    parent_comment_id                       uuid,
    root_comment_id                         uuid,
    depth                                   smallint,
    body                                    text,
    author_identity                         public.post_identity,
    author_pub_id                           text,
    author_name                             text,
    author_avatar_path                      text,
    author_label                            text,
    created_at                              timestamp with time zone,
    edited_at                               timestamp with time zone,
    is_deleted                              boolean,
    is_effective_feed_bump                  boolean,
    is_author                               boolean,
    can_edit                                boolean,
    can_delete                              boolean,
    reply_count                             integer,
    reaction_count                          integer,
    top_reactions                           public.post_reaction[],
    my_reaction                             public.post_reaction,
    parent_author_label                     text,
    can_moderate_anonymous                  boolean,
    anonymous_author_restricted             boolean,
    anonymous_author_restriction_expires_at timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  comment_record public.post_comments;
  current_image public.comment_images;
  next_image public.comment_images;
  context record;
  trimmed_body text := btrim(coalesce(p_body, ''));
  image_changed boolean;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select comment.* into comment_record
  from public.post_comments as comment
  where comment.id = p_comment_id and comment.deleted_at is null
  for update;
  if comment_record.id is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from private.comment_authors as author
    where author.comment_id = p_comment_id and author.profile_id = caller_profile_id
  ) then
    raise exception 'only the author can edit a comment' using errcode = '42501';
  end if;
  if exists (
    select 1
    from private.feed_bump_events as bump
    where bump.comment_id = p_comment_id
  ) then
    raise exception 'effective #업 comments cannot be edited' using errcode = '22023';
  end if;

  context := private.comment_post_context(comment_record.post_id, caller_profile_id);
  if not context.is_visible then
    raise exception 'post is not accessible' using errcode = '42501';
  end if;
  if char_length(trimmed_body) > 5000 then
    raise exception 'comment must contain between 1 and 5000 characters' using errcode = '22023';
  end if;
  if coalesce(p_remove_image, false) and p_image_id is not null then
    raise exception 'cannot replace and remove a comment image together' using errcode = '22023';
  end if;

  select image.* into current_image
  from public.comment_images as image
  where image.comment_id = p_comment_id and image.status = 'ready'
  for update;
  if trimmed_body = ''
    and p_image_id is null
    and (coalesce(p_remove_image, false) or current_image.id is null) then
    raise exception 'comment requires a body or finalized image' using errcode = '22023';
  end if;
  image_changed := case
    when coalesce(p_remove_image, false) then current_image.id is not null
    when p_image_id is null then false
    else current_image.id is distinct from p_image_id
  end;

  if p_image_id is not null and image_changed then
    select image.* into next_image
    from public.comment_images as image
    where image.id = p_image_id
    for update;
    if next_image.id is null
      or next_image.post_id <> comment_record.post_id
      or next_image.status <> 'finalized'
      or next_image.comment_id is not null
      or not private.is_comment_image_uploader(p_image_id) then
      raise exception 'finalized comment image is not claimable' using errcode = '42501';
    end if;
  end if;

  if image_changed and current_image.id is not null then
    update public.comment_images
    set status = 'deleted', deleted_at = now()
    where id = current_image.id;
  end if;
  if p_image_id is not null and image_changed then
    update public.comment_images
    set comment_id = p_comment_id, status = 'ready', ready_at = now()
    where id = p_image_id;
  end if;

  update public.post_comments as comment
  set body = trimmed_body,
    edited_at = case
      when comment_record.body is distinct from trimmed_body or image_changed then now()
      else comment_record.edited_at
    end
  where comment.id = p_comment_id;

  return query
  select entry.*
  from private.read_post_comments(
    array[p_comment_id], caller_profile_id, context.caller_role
  ) as entry;
end;
$function$;

CREATE TABLE public.profile_media_objects (
  id           uuid                        DEFAULT gen_random_uuid() NOT NULL,
  profile_id   bigint                      NOT NULL,
  auth_user_id uuid                        NOT NULL,
  slot         public.profile_media_slot   NOT NULL,
  object_path  text                        NOT NULL,
  size_bytes   bigint                      NOT NULL,
  width        integer                     NOT NULL,
  height       integer                     NOT NULL,
  status       public.profile_media_status DEFAULT 'pending'::public.profile_media_status NOT NULL,
  created_at   timestamp with time zone    DEFAULT now() NOT NULL,
  ready_at     timestamp with time zone
);

CREATE VIEW private.referenced_storage_objects AS SELECT 'profile-media'::text AS bucket,
    profile.avatar_path AS object_path
   FROM public.profiles profile
  WHERE (profile.avatar_path IS NOT NULL)
UNION ALL
 SELECT 'profile-media'::text AS bucket,
    profile.cover_path AS object_path
   FROM public.profiles profile
  WHERE (profile.cover_path IS NOT NULL)
UNION ALL
 SELECT 'profile-media'::text AS bucket,
    post.activity_media_path AS object_path
   FROM public.posts post
  WHERE ((post.activity_media_path IS NOT NULL) AND (post.deleted_at IS NULL))
UNION ALL
 SELECT 'profile-media'::text AS bucket,
    media.object_path
   FROM public.profile_media_objects media
UNION ALL
 SELECT attachment.storage_bucket AS bucket,
    attachment.object_path
   FROM public.post_attachments attachment
UNION ALL
 SELECT image.storage_bucket AS bucket,
    image.object_path
   FROM public.comment_images image
UNION ALL
 SELECT 'group-media'::text AS bucket,
    media.object_path
   FROM public.group_media_objects media;

ALTER TABLE public.profile_media_objects
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profile_media_objects
  ADD CONSTRAINT profile_media_dimensions_check
    CHECK
    (slot = 'avatar'::public.profile_media_slot AND width = height AND width >= 1 AND width <= 512 OR slot = 'cover'::public.profile_media_slot AND width >= 3 AND width <= 2400 AND
    width >= (height * 2));

ALTER TABLE public.profile_media_objects
  ADD CONSTRAINT profile_media_objects_object_path_key UNIQUE (object_path);

ALTER TABLE public.profile_media_objects
  ADD CONSTRAINT profile_media_objects_pkey PRIMARY KEY (id);

ALTER TABLE public.profile_media_objects
  ADD CONSTRAINT profile_media_objects_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.profile_media_objects
  ADD CONSTRAINT profile_media_path_check CHECK (object_path = ((((auth_user_id::text || '/'::text) || slot::text) || '/'::text) || id::text));

ALTER TABLE public.profile_media_objects
  ADD CONSTRAINT profile_media_size_check CHECK (size_bytes >= 1 AND size_bytes <=
CASE slot
    WHEN 'avatar'::public.profile_media_slot THEN 1048576
    ELSE 4194304
END);

ALTER TABLE public.profile_media_objects
  ADD CONSTRAINT profile_media_status_timestamps_check
    CHECK (status = 'pending'::public.profile_media_status AND ready_at IS NULL OR status = 'ready'::public.profile_media_status AND ready_at IS NOT NULL);

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.profile_media_objects TO service_role;

CREATE INDEX profile_media_objects_cleanup_idx ON public.profile_media_objects (created_at, id);

-- Migration unit 2: manual_additions
-- Transaction mode: transactional
-- Boundary reason: storage policies, default-privilege revokes, Vault DML, and cron
-- registration are not represented by schema diff

-- 기본 권한에서 새어 나오는 MAINTAIN/REFERENCES/TRIGGER/TRUNCATE를 명시적으로 회수한다.
-- pg_dump는 기본 권한 기준으로 ACL을 렌더링하므로 이 revoke를 생략한다.
revoke maintain, references, trigger, truncate
on table public.profile_media_objects from anon, authenticated;
revoke all on table public.profile_media_objects from anon, authenticated;
revoke all on table private.storage_cleanup_queue from anon, authenticated;
revoke all on table private.storage_cleanup_runs from anon, authenticated;

create policy "profile_media_insert_pending_owner" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-media'
    and owner_id = (select auth.uid()::text)
    and private.can_upload_profile_media(name)
  );

-- 시크릿 이름을 워커 이름에 맞춘다. 값은 그대로 두므로 각 환경에서 다시 만들 필요가 없고,
-- 이름이 어긋난 채 401만 반복되는 상태로 배포되지 않는다.
select vault.update_secret(
  (select id from vault.secrets where name = 'post_attachment_cleanup_secret'),
  new_name => 'storage_cleanup_secret'
)
where exists (
  select 1 from vault.secrets where name = 'post_attachment_cleanup_secret'
)
and not exists (
  select 1 from vault.secrets where name = 'storage_cleanup_secret'
);

select cron.unschedule(jobid)
from cron.job
where jobname = 'cleanup-post-attachments-daily';

-- 1층. 수명을 다한 행을 큐로 옮긴다. 순수 SQL이라 Edge Function 설정과 무관하게 돈다.
select cron.schedule(
  'enqueue-storage-cleanup-daily',
  '17 3 * * *',
  'select private.enqueue_storage_cleanup()'
);

-- 2층. 처음에는 dry-run으로 후보만 쌓고 삭제하지 않는다. 관리자 화면에서 후보를 확인한 뒤
-- 별도 마이그레이션으로 `p_dry_run => false`로 바꾼다.
select cron.schedule(
  'sweep-unreferenced-storage-weekly',
  '41 4 * * 0',
  'select private.sweep_unreferenced_storage_objects(p_dry_run => true)'
);

-- 큐 드레인. 1층 적재 직후에 돌려 하루 안에 실제 삭제까지 끝낸다.
select cron.schedule(
  'drain-storage-cleanup-daily',
  '47 3 * * *',
  'select private.invoke_storage_cleanup()'
);

-- pg_net 응답은 몇 시간 뒤 사라지므로 자주 회수한다.
select cron.schedule(
  'reconcile-storage-cleanup-runs',
  '*/5 * * * *',
  'select private.reconcile_storage_cleanup_runs()'
);
