-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

-- 컬럼을 함수보다 먼저 만든다. 아래 함수 본문이 `thumbnail_path`를 읽으므로,
-- `check_function_bodies = false`에 기대지 않고 순서로 성립시킨다.

ALTER TABLE public.post_attachments
  ADD COLUMN thumbnail_path text;

ALTER TABLE public.post_attachments
  ADD CONSTRAINT post_attachments_thumbnail_image_only_check CHECK (thumbnail_path IS NULL OR mime_type ~~ 'image/%'::text);

ALTER TABLE public.post_attachments
  ADD CONSTRAINT post_attachments_thumbnail_path_check CHECK (thumbnail_path IS NULL OR thumbnail_path = ((object_path || '/'::text) || 'thumb'::text));

DROP FUNCTION public.list_post_attachments(IN p_post_id uuid);

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
    returning
      attachment.storage_bucket as bucket,
      attachment.object_path as object_path,
      attachment.thumbnail_path as thumbnail_path
  )
  -- 이미지 첨부는 object가 둘이다(원본 + 썸네일). 행은 이미 지워졌으므로 여기서 둘 다
  -- 큐에 넣지 않으면 남는 쪽의 경로를 다시 알아낼 방법이 없다.
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select expired.bucket, path.object_path, 'post_attachment'
  from expired
  cross join lateral (
    values (expired.object_path), (expired.thumbnail_path)
  ) as path(object_path)
  where path.object_path is not null
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

CREATE OR REPLACE FUNCTION private.purge_posts (
  p_post_ids uuid[]
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  purged integer;
begin
  if p_post_ids is null or pg_catalog.cardinality(p_post_ids) = 0 then
    return 0;
  end if;

  -- 랭킹 이벤트도 함께 사라져야 한다. 그 CASCADE는 append-only 트리거를 거치므로 정리 경로임을
  -- 먼저 밝힌다(삭제 및 보존 정책 §7.4).
  perform pg_catalog.set_config('app.feed_event_purge', 'on', true);

  -- 이미지 첨부는 object가 둘이다(원본 + 썸네일). 둘 다 큐에 넣지 않으면 남는 쪽은
  -- 참조가 사라진 뒤라 아무도 경로를 모르는 고아가 된다.
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select attachment.storage_bucket, path.object_path, 'post_attachment'
  from public.post_attachments as attachment
  cross join lateral (
    values (attachment.object_path), (attachment.thumbnail_path)
  ) as path(object_path)
  where attachment.post_id = any(p_post_ids)
    and path.object_path is not null
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;

  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select image.storage_bucket, image.object_path, 'comment_image'
  from public.comment_images as image
  where image.post_id = any(p_post_ids)
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;

  delete from public.posts as post where post.id = any(p_post_ids);
  get diagnostics purged = row_count;

  perform pg_catalog.set_config('app.feed_event_purge', 'off', true);

  -- 파일까지 수초 안에 사라지도록 워커를 깨운다. 실패해도 행 삭제는 이미 끝났고 경로는 큐에
  -- 남아 백스톱이 받는다. 그래서 이 호출은 조용해야 한다(삭제 및 보존 정책 §4.1).
  perform private.invoke_storage_cleanup(p_quiet => true);

  return purged;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_post_attachment (
  p_attachment_id uuid
)
  RETURNS public.post_attachments
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  attachment public.post_attachments;
  object_record storage.objects;
  thumbnail_record storage.objects;
  is_published boolean;
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select item.* into attachment from public.post_attachments as item
  where item.id = p_attachment_id for update;
  if attachment.id is null or not private.is_post_author(attachment.post_id) then
    raise exception 'only the author can finalize attachments' using errcode = '42501';
  end if;
  if attachment.status = 'deleted' then
    raise exception 'attachment is not pending' using errcode = '55000';
  end if;
  select post.published_at is not null into is_published
  from public.posts as post
  where post.id = attachment.post_id;
  if is_published is null then
    raise exception 'post is deleted' using errcode = '55000';
  end if;
  select object.* into object_record
  from storage.objects as object
  where object.bucket_id = attachment.storage_bucket
    and object.name = attachment.object_path;
  if object_record.id is null then
    raise exception 'uploaded object not found' using errcode = 'P0002';
  end if;
  if object_record.owner_id is distinct from auth.uid()::text then
    raise exception 'uploaded object owner does not match' using errcode = '42501';
  end if;
  if nullif(object_record.metadata ->> 'size', '')::bigint is distinct from attachment.size_bytes
    or object_record.metadata ->> 'mimetype' is distinct from attachment.mime_type then
    raise exception 'uploaded object metadata does not match' using errcode = '22023';
  end if;

  -- 썸네일이 없으면 실패시키지 않고 경로를 지운다. 축소본은 데이터 절약 수단이지 게시물의
  -- 일부가 아니라서, 그것 하나 때문에 원본이 멀쩡한 글의 업로드를 되돌릴 이유가 없다.
  -- 읽는 쪽은 `thumbnail_path`가 없으면 원본으로 떨어지므로 화면은 그대로 동작한다.
  if attachment.thumbnail_path is not null then
    select object.* into thumbnail_record
    from storage.objects as object
    where object.bucket_id = attachment.storage_bucket
      and object.name = attachment.thumbnail_path;

    if thumbnail_record.id is null
      or thumbnail_record.owner_id is distinct from auth.uid()::text
      or thumbnail_record.metadata ->> 'mimetype' not like 'image/%' then
      update public.post_attachments
      set thumbnail_path = null
      where id = p_attachment_id
      returning * into attachment;
    end if;
  end if;

  if attachment.status = 'ready' then
    return attachment;
  end if;
  if not is_published then
    update public.post_attachments
    set status = 'ready', ready_at = now()
    where id = p_attachment_id
    returning * into attachment;
  end if;
  return attachment;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_feed_posts (
  p_page_token uuid DEFAULT NULL::uuid
)
  RETURNS TABLE (
    feed_epoch          timestamp with time zone,
    next_page_token     uuid,
    feed_position       integer,
    rank_time           timestamp with time zone,
    post_id             uuid,
    kind                public.post_kind,
    body                text,
    title               text,
    author_identity     public.post_identity,
    author_pub_id       text,
    author_name         text,
    author_avatar_path  text,
    author_label        text,
    group_id            uuid,
    group_slug          text,
    group_name          text,
    category_name       text,
    is_pinned           boolean,
    timeline_pub_id     text,
    timeline_name       text,
    activity_kind       public.profile_media_activity_kind,
    activity_media_path text,
    visibility          public.post_visibility,
    published_at        timestamp with time zone,
    edited_at           timestamp with time zone,
    comment_count       integer,
    reaction_count      integer,
    top_reactions       public.post_reaction[],
    my_reaction         public.post_reaction,
    attachments         jsonb,
    is_author           boolean,
    mentions            jsonb
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_session_id uuid;
  target_epoch timestamptz;
  page_after_position integer := 0;
  page_last_position integer;
  following_page_token uuid;
  selected_positions integer[];
  selected_post_ids uuid[];
  selected_rank_times timestamptz[];
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  if p_page_token is null then
    target_session_id := private.create_feed_session(caller_profile_id);
    select session.feed_epoch into target_epoch
    from private.feed_sessions as session
    where session.id = target_session_id;
  else
    select page.session_id, page.after_position, session.feed_epoch
    into target_session_id, page_after_position, target_epoch
    from private.feed_pages as page
    join private.feed_sessions as session on session.id = page.session_id
    where page.token = p_page_token
      and session.profile_id = caller_profile_id
      and session.expires_at > statement_timestamp();

    if target_session_id is null then
      raise exception 'feed page not found or expired' using errcode = '22023';
    end if;
  end if;

  select
    array_agg(page.position order by page.position),
    array_agg(page.post_id order by page.position),
    array_agg(page.rank_time order by page.position)
  into selected_positions, selected_post_ids, selected_rank_times
  from (
    select entry.position, entry.post_id, entry.rank_time
    from private.feed_session_posts as entry
    where entry.session_id = target_session_id
      and entry.position > page_after_position
      and private.can_access_feed_post(entry.post_id, caller_profile_id)
    order by entry.position
    limit 20
  ) as page;

  if cardinality(selected_positions) > 0 then
    page_last_position := selected_positions[cardinality(selected_positions)];
  end if;

  if page_last_position is not null and exists (
    select 1
    from private.feed_session_posts as entry
    where entry.session_id = target_session_id
      and entry.position > page_last_position
      and private.can_access_feed_post(entry.post_id, caller_profile_id)
  ) then
    insert into private.feed_pages (session_id, after_position)
    values (target_session_id, page_last_position)
    on conflict (session_id, after_position) do nothing;

    select page.token into following_page_token
    from private.feed_pages as page
    where page.session_id = target_session_id
      and page.after_position = page_last_position;
  end if;

  return query
  select
    target_epoch,
    following_page_token,
    selected.position,
    selected.rank_time,
    post.id,
    post.kind,
    post.body,
    post.title,
    post.author_identity,
    case when post.author_identity in ('identified', 'staff') then author_profile.pub_id end,
    case when post.author_identity in ('identified', 'staff') then author_profile.name end,
    case when post.author_identity in ('identified', 'staff') then author_profile.avatar_path end,
    case post.author_identity
      when 'identified' then author_profile.name
      when 'anonymous' then '익명'
      when 'staff' then '운영진'
    end,
    post.group_id,
    group_record.slug,
    group_record.name,
    category.name,
    post.pinned_at is not null,
    timeline.pub_id,
    timeline.name,
    post.activity_kind,
    post.activity_media_path,
    post.visibility,
    post.published_at,
    post.edited_at,
    post.comment_count,
    reaction_summary.total,
    reaction_summary.top,
    mine.reaction,
    attachment_summary.items,
    author.profile_id = caller_profile_id,
    private.post_mentions_json(post.id)
  from unnest(selected_positions, selected_post_ids, selected_rank_times)
    as selected(position, post_id, rank_time)
  join public.posts as post on post.id = selected.post_id
  join private.post_authors as author on author.post_id = post.id
  left join public.profiles as author_profile
    on (
      (post.author_identity = 'identified' and author_profile.id = post.display_author_profile_id)
      or (post.author_identity = 'staff' and author_profile.id = author.profile_id)
    )
    and author_profile.status = 'accepted'
    and author_profile.deleted_at is null
  left join public.groups as group_record on group_record.id = post.group_id
  left join public.group_categories as category on category.id = post.category_id
  left join public.profiles as timeline
    on timeline.id = post.timeline_profile_id
    and timeline.status = 'accepted'
    and timeline.deleted_at is null
  left join public.post_reactions as mine
    on mine.post_id = post.id and mine.profile_id = caller_profile_id
  left join lateral (
    select
      coalesce(sum(tally.n), 0)::integer as total,
      coalesce(
        array_agg(tally.reaction order by tally.n desc, tally.reaction)
          filter (where tally.rank <= 3),
        array[]::public.post_reaction[]
      ) as top
    from (
      select entry.reaction, count(*)::integer as n,
        row_number() over (order by count(*) desc, entry.reaction) as rank
      from public.post_reactions as entry
      where entry.post_id = post.id
      group by entry.reaction
    ) as tally
  ) as reaction_summary on true
  left join lateral (
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
          'height', attachment.height
        ) order by attachment.position, attachment.id
      ),
      '[]'::jsonb
    ) as items
    from public.post_attachments as attachment
    where attachment.post_id = post.id and attachment.status = 'ready'
  ) as attachment_summary on true
  order by selected.position;
end;
$function$;

CREATE FUNCTION public.list_post_attachments (
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
    status            public.post_attachment_status,
    created_at        timestamp with time zone,
    ready_at          timestamp with time zone
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select item.id, item.post_id, item.storage_bucket, item.object_path,
    item.thumbnail_path, item.original_filename, item.position, item.mime_type,
    item.size_bytes, item.width, item.height, item.status, item.created_at,
    item.ready_at
  from public.post_attachments as item
  where item.post_id = p_post_id
    and item.status <> 'deleted'
    and (
      item.status = 'ready'
      or private.is_post_author(item.post_id)
    )
  order by item.position, item.id;
$function$;

REVOKE ALL ON FUNCTION public.list_post_attachments(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_post_attachments(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.prepare_post_attachment (
  p_post_id           uuid,
  p_original_filename text,
  p_mime_type         text,
  p_size_bytes        bigint,
  p_width             integer DEFAULT NULL::integer,
  p_height            integer DEFAULT NULL::integer
)
  RETURNS public.post_attachments
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  post_record public.posts;
  attachment public.post_attachments;
  attachment_id uuid := gen_random_uuid();
  next_position integer;
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record from public.posts as post
  where post.id = p_post_id
  for update;
  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can add attachments' using errcode = '42501';
  end if;
  if lower(btrim(p_mime_type)) like 'video/%'
     or lower(btrim(p_original_filename)) ~ '\.(mp4|m4v|mov|webm|avi|mkv|mpeg|mpg|3gp|3g2|ogv|m2ts)$' then
    raise exception 'video attachments are not supported' using errcode = '22023';
  end if;
  if (select count(*) from public.post_attachments
      where post_id = p_post_id and status <> 'deleted') >= 30 then
    raise exception 'a post can have at most 30 attachments' using errcode = '23514';
  end if;

  select coalesce(min(candidate), 0) into next_position
  from generate_series(0, 29) as candidate
  where not exists (
    select 1 from public.post_attachments
    where post_id = p_post_id and status <> 'deleted' and position = candidate
  );

  -- 이미지에만 썸네일 경로를 예고한다. pdf·hwp에는 축소본이랄 것이 없고, CHECK 제약도
  -- 이미지가 아닌 행에 `thumbnail_path`가 붙는 것을 막는다. 경로는 원본에서 파생되므로
  -- 클라이언트가 정하지 않는다 — Storage 정책이 이 행이 예고한 두 경로만 통과시킨다.
  insert into public.post_attachments (
    id, post_id, object_path, thumbnail_path, original_filename, position,
    mime_type, size_bytes, width, height
  ) values (
    attachment_id, p_post_id, p_post_id::text || '/' || attachment_id::text,
    case
      when lower(btrim(p_mime_type)) like 'image/%'
      then p_post_id::text || '/' || attachment_id::text || '/thumb'
    end,
    btrim(p_original_filename), next_position, btrim(p_mime_type),
    p_size_bytes, p_width, p_height
  ) returning * into attachment;
  return attachment;
end;
$function$;

-- `db diff`는 `storage.objects` 정책을 내놓지 않는다(supabase/README.md의
-- "Storage policies and extensions"). 손으로 옮긴다 — 이게 빠지면 컬럼과 함수는 생기지만
-- 썸네일 업로드와 서명이 RLS에서 막힌다. 마이그레이션은 트랜잭션이라 drop/create 사이에
-- 정책이 비는 순간은 없다.

DROP POLICY IF EXISTS "post_attachments_storage_insert_pending_author" ON "storage"."objects";

CREATE POLICY "post_attachments_storage_insert_pending_author" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'post-attachments'::"text") AND ("owner_id" = ( SELECT ("auth"."uid"())::"text" AS "uid")) AND (EXISTS ( SELECT 1
   FROM ("public"."post_attachments" "attachment"
     JOIN "public"."posts" "post" ON (("post"."id" = "attachment"."post_id")))
  WHERE (("attachment"."storage_bucket" = "objects"."bucket_id") AND ("objects"."name" IN ("attachment"."object_path", "attachment"."thumbnail_path")) AND ("attachment"."status" = 'pending'::"public"."post_attachment_status") AND "private"."is_post_author"("post"."id"))))));

DROP POLICY IF EXISTS "post_attachments_storage_select_reader" ON "storage"."objects";

CREATE POLICY "post_attachments_storage_select_reader" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'post-attachments'::"text") AND "storage"."allow_any_operation"(ARRAY['object.get_authenticated_info'::"text", 'object.get_authenticated'::"text", 'object.sign'::"text", 'object.sign_many'::"text"]) AND (EXISTS ( SELECT 1
   FROM "public"."post_attachments" "attachment"
  WHERE (("attachment"."storage_bucket" = "objects"."bucket_id") AND ("objects"."name" IN ("attachment"."object_path", "attachment"."thumbnail_path")) AND ("attachment"."status" = 'ready'::"public"."post_attachment_status") AND "private"."can_read_post"("attachment"."post_id"))))));
