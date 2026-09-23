-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE VIEW private.referenced_storage_objects AS SELECT 'profile-media'::text AS bucket,
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
  WHERE (post.activity_media_path IS NOT NULL)
UNION ALL
 SELECT 'profile-media'::text AS bucket,
    media.object_path
   FROM public.profile_media_objects media
UNION ALL
 SELECT attachment.storage_bucket AS bucket,
    attachment.object_path
   FROM public.post_attachments attachment
UNION ALL
 SELECT attachment.storage_bucket AS bucket,
    attachment.thumbnail_path AS object_path
   FROM public.post_attachments attachment
  WHERE (attachment.thumbnail_path IS NOT NULL)
UNION ALL
 SELECT image.storage_bucket AS bucket,
    image.object_path
   FROM public.comment_images image
UNION ALL
 SELECT 'group-media'::text AS bucket,
    media.object_path
   FROM public.group_media_objects media;

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
      -- Storage metadata comes from the upload request, so do not trust the
      -- client-side compressor to enforce the thumbnail contract by itself.
      or thumbnail_record.metadata ->> 'mimetype' is distinct from 'image/webp'
      or case
        when thumbnail_record.metadata ->> 'size' ~ '^[0-9]+$'
        then (thumbnail_record.metadata ->> 'size')::bigint > 1048576
        else true
      end then
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