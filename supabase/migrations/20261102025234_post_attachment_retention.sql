SET local check_function_bodies = off;

DROP POLICY "post_attachments_storage_select_reader" ON "storage"."objects";

DROP FUNCTION "public"."list_post_attachments"(uuid);

ALTER TABLE "public"."post_attachments"
  ADD COLUMN "expired_at" timestamp WITH time zone;

CREATE OR REPLACE FUNCTION private.cleanup_expired_records()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  removed bigint := 0;
  affected bigint;
  korea_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  -- 스토리는 만료되면 읽는 경로가 없다(기능 명세 §17.6). publish하지 못한 사진 스토리는 48시간을
  -- 기다린다. Storage 2층 스윕과 같은 유예라 업로드 중인 행을 지우지 않는다. 행을 지우는 문장이
  -- 이미지 경로를 정리 큐로 옮긴다.
  with expired as (
    delete from public.stories as story
    where (story.status = 'ready' and story.expires_at <= now())
      or (story.status = 'pending' and story.created_at <= now() - interval '48 hours')
    returning story.image_path, story.thumbnail_path
  ), queued as (
    insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
    select 'story-media', path.object_path, 'story_media'
    from expired
    cross join lateral (
      values (expired.image_path), (expired.thumbnail_path)
    ) as path(object_path)
    where path.object_path is not null
    on conflict (bucket, object_path) do update
      set dry_run = queue.dry_run and excluded.dry_run
  )
  select count(*) into affected from expired;
  removed := removed + affected;

  -- 메시지의 사진이 아닌 첨부는 500KB(512000바이트)를 넘으면 1년만 보관한다. 대화 맥락을 위해 행과
  -- 동영상 첫 프레임은 남기고 파일만 큐로 옮긴다. 조건을 바꾸면 `message_attachments_retention_idx`도 바꾼다.
  with expired as (
    update private.message_attachments as attachment
    set status = 'expired'
    where attachment.status = 'ready'
      and attachment.kind <> 'image'
      and attachment.size_bytes > 512000
      and attachment.created_at <= now() - interval '1 year'
    returning attachment.object_path
  ), queued as (
    insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
    select 'message-attachments', expired.object_path, 'message_attachment'
    from expired
    on conflict (bucket, object_path) do update
      set dry_run = queue.dry_run and excluded.dry_run
  )
  select count(*) into affected from expired;
  removed := removed + affected;

  -- 게시물도 같은 기준이다. 그룹과 개인 게시물을 가르지 않고, 고정한 글은 고정된 동안 건너뛴다. 해제하면
  -- 그다음 정리 때 기간을 다시 본다. 조건을 바꾸면 `post_attachments_retention_idx`도 바꾼다.
  with expired as (
    update public.post_attachments as attachment
    set expired_at = now()
    from public.posts as post
    where post.id = attachment.post_id
      and post.pinned_at is null
      and attachment.status = 'ready'
      and attachment.expired_at is null
      and lower(attachment.mime_type) not like 'image/%'
      and attachment.size_bytes > 512000
      and attachment.created_at <= now() - interval '1 year'
    returning attachment.storage_bucket, attachment.object_path
  ), queued as (
    insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
    select expired.storage_bucket, expired.object_path, 'post_attachment'
    from expired
    on conflict (bucket, object_path) do update
      set dry_run = queue.dry_run and excluded.dry_run
  )
  select count(*) into affected from expired;
  removed := removed + affected;

  -- 예약은 끝난 뒤 2주까지 남긴다. 반복 예약은 종료일이 정해지기 전까지 지우지 않는다.
  delete from public.utility_reservations as reservation
  where case
      when reservation.recurring then reservation.recurring_until
      else reservation.reservation_date
    end < korea_today - 14;
  get diagnostics affected = row_count;
  removed := removed + affected;

  -- 관리자 반복 선예약도 같다. 첫 날짜가 지나도 반복이 끝나기 전에는 학생 예약을 막고 있다.
  delete from public.gongang_schedule as schedule
  where case
      when schedule.recurring then schedule.recurring_until
      else schedule.schedule_date
    end < korea_today - 14;
  get diagnostics affected = row_count;
  removed := removed + affected;

  -- 랭킹 이벤트는 append-only 라 정리 경로임을 밝혀야 지울 수 있다(삭제 및 보존 정책 §7.4).
  perform pg_catalog.set_config('app.feed_event_purge', 'on', true);

  -- 반응 이벤트는 발행 후 6시간 이내 게시물에만 합산된다. 그보다 오래된 것은 어떤 조회에도 잡히지
  -- 않는다. 경계를 넉넉히 두려고 하루를 남긴다.
  delete from private.post_reaction_count_events
  where occurred_at < now() - interval '24 hours';
  get diagnostics affected = row_count;
  removed := removed + affected;

  -- `#업` 이벤트는 게시물당 가장 최근 하나만 읽는다. 1시간 중복 방지 검사도 최근 구간만 보므로
  -- 최신 한 건을 남기면 두 조회가 모두 그대로 동작한다. 나머지는 죽은 데이터다.
  delete from private.feed_bump_events as bump
  where exists (
    select 1
    from private.feed_bump_events as newer
    where newer.post_id = bump.post_id
      and (newer.effective_at, newer.id) > (bump.effective_at, bump.id)
  );
  get diagnostics affected = row_count;
  removed := removed + affected;

  perform pg_catalog.set_config('app.feed_event_purge', 'off', true);

  return removed;
end;
$function$;

CREATE OR REPLACE FUNCTION private.current_terms_version()
  RETURNS date
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  -- 시행 중인 이용약관의 시행일. 약관을 개정하면 docs/legal/terms_of_service.md의 시행일과
  -- 앱의 TERMS_VERSION을 함께 올린다.
  select date '2026-11-10';
$function$;

CREATE OR REPLACE FUNCTION private.post_attachments_json (
  p_post_id uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'attachment_id', attachment.id,
        'storage_bucket', attachment.storage_bucket,
        'object_path', attachment.object_path,
        'thumbnail_path', attachment.thumbnail_path,
        'original_filename', attachment.original_filename,
        'position', attachment.position,
        'mime_type', attachment.mime_type,
        'size_bytes', attachment.size_bytes,
        'width', attachment.width,
        'height', attachment.height,
        'media_kind', attachment.media_kind,
        'expired', attachment.expired_at is not null
      )
      order by attachment.position, attachment.id
    ),
    '[]'::jsonb
  )
  from public.post_attachments as attachment
  where attachment.post_id = p_post_id and attachment.status = 'ready';
$function$;

CREATE OR REPLACE FUNCTION public.list_post_attachments (
  p_post_id uuid
)
  RETURNS TABLE (
    attachment_id     uuid,
    post_id           uuid,
    storage_bucket    text,
    object_path       text,
    thumbnail_path    text,
    original_filename text,
    "position"        integer,
    mime_type         text,
    size_bytes        bigint,
    width             integer,
    height            integer,
    media_kind        text,
    status            public.post_attachment_status,
    created_at        timestamp with time zone,
    ready_at          timestamp with time zone,
    expired           boolean
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select item.id, item.post_id, item.storage_bucket, item.object_path,
    item.thumbnail_path, item.original_filename, item.position, item.mime_type,
    item.size_bytes, item.width, item.height, item.media_kind, item.status, item.created_at,
    item.ready_at, item.expired_at is not null
  from public.post_attachments as item
  where item.post_id = p_post_id
    and item.status <> 'deleted'
    and (
      item.status = 'ready'
      or private.is_post_author(item.post_id)
    )
  order by item.position, item.id;
$function$;

REVOKE ALL ON FUNCTION "public"."list_post_attachments"(uuid) FROM PUBLIC, "anon", "service_role";

CREATE INDEX post_attachments_retention_idx ON public.post_attachments USING btree (created_at)
  WHERE ((status = 'ready'::public.post_attachment_status) AND (expired_at IS NULL) AND (lower(mime_type) !~~ 'image/%'::text) AND (size_bytes > 512000));

CREATE POLICY "post_attachments_storage_select_reader" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING
    (((bucket_id = 'post-attachments'::text) AND storage.allow_any_operation(ARRAY['object.get_authenticated_info'::text, 'object.get_authenticated'::text, 'object.sign'::text,
    'object.sign_many'::text]) AND (EXISTS ( SELECT 1
   FROM public.post_attachments attachment
  WHERE
    ((attachment.storage_bucket = objects.bucket_id) AND ((objects.name = attachment.thumbnail_path) OR ((objects.name = attachment.object_path) AND (attachment.expired_at IS
    NULL))) AND (attachment.status = 'ready'::public.post_attachment_status) AND private.can_read_post(attachment.post_id))))));

GRANT EXECUTE ON FUNCTION "public"."list_post_attachments"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_post_attachments"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_post_attachments"(uuid) TO "postgres";
