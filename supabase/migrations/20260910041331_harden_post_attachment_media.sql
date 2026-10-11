-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

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
  removed_object_count integer;
begin
  if char_length(coalesce(p_body, '')) > 20000 then
    raise exception 'body must contain between 0 and 20000 characters' using errcode = '22023';
  end if;
  if attachment_count > 30
    or attachment_count <> (
      select count(distinct attachment_id)
      from unnest(coalesce(p_attachment_ids, '{}'::uuid[])) as attachment_id
    ) then
    raise exception 'attachment order must contain at most 30 unique ids' using errcode = '22023';
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
        or (
          lower(attachment.mime_type) like 'image/%'
          and attachment.size_bytes > 8388608
        )
      )
  ) then
    raise exception 'uploaded attachment metadata does not match' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null and attachment_count = 0 then
    raise exception 'post requires a body or ready attachment' using errcode = '22023';
  end if;

  -- 편집에서 뺀 첨부도 단독 삭제와 같은 수명주기를 따른다. tombstone 행이 순서를 보존해도
  -- object는 더 이상 읽히지 않으므로, 원본과 축소본을 먼저 큐에 넣고 워커를 깨운다.
  with removed as (
    update public.post_attachments
    set status = 'deleted', deleted_at = now()
    where post_id = p_post_id
      and status <> 'deleted'
      and not (id = any(coalesce(p_attachment_ids, '{}'::uuid[])))
    returning storage_bucket, object_path, thumbnail_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select removed.storage_bucket, path.object_path, 'post_attachment'
  from removed
  cross join lateral (
    values (removed.object_path), (removed.thumbnail_path)
  ) as path(object_path)
  where path.object_path is not null
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics removed_object_count = row_count;
  if removed_object_count > 0 then
    perform private.invoke_storage_cleanup(p_quiet => true);
  end if;

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
    insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
    select attachment.storage_bucket, path.object_path, 'post_attachment'
    from (
      values (attachment.object_path), (attachment.thumbnail_path)
    ) as path(object_path)
    where path.object_path is not null
    on conflict (bucket, object_path) do update
      set dry_run = queue.dry_run and excluded.dry_run;

    update public.post_attachments
    set status = 'deleted', deleted_at = now()
    where id = p_attachment_id;

    perform private.invoke_storage_cleanup(p_quiet => true);
  end if;
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
  if lower(attachment.mime_type) like 'image/%'
    and attachment.size_bytes > 8388608 then
    raise exception 'image attachments must be 8 MiB or smaller' using errcode = '22023';
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
      -- Storage metadata comes from the upload request, so do not trust the
      -- client-side compressor to enforce the thumbnail contract by itself.
      or thumbnail_record.metadata ->> 'mimetype' is distinct from 'image/webp'
      or (
        case
          when thumbnail_record.metadata ->> 'size' ~ '^[0-9]+$'
          then (thumbnail_record.metadata ->> 'size')::bigint > 1048576
          else true
        end
      ) then
      -- A rejected thumbnail is not referenced after this point. Queue the
      -- uploaded object before clearing its path so the sweeper does not have
      -- to discover it 48 hours later.
      if thumbnail_record.id is not null then
        insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
        values (attachment.storage_bucket, attachment.thumbnail_path, 'post_attachment')
        on conflict (bucket, object_path) do update
          set dry_run = queue.dry_run and excluded.dry_run;
      end if;

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
  if lower(btrim(p_mime_type)) like 'image/%'
    and p_size_bytes > 8388608 then
    raise exception 'image attachments must be 8 MiB or smaller' using errcode = '22023';
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