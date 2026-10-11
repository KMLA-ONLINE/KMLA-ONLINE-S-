SET local check_function_bodies = off;

ALTER TABLE "public"."stories"
  DROP CONSTRAINT "stories_content_length";

ALTER TABLE "public"."stories"
  DROP CONSTRAINT "stories_kind_check";

CREATE OR REPLACE FUNCTION private.normalize_story_text (
  p_value text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select pg_catalog.regexp_replace(
    coalesce(p_value, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'
  );
$function$;

CREATE OR REPLACE FUNCTION public.create_text_story (
  p_content    text,
  p_background text,
  p_link_url   text DEFAULT NULL::text
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.story_writer_profile_id();
  created_id bigint;
  published timestamptz := now();
begin
  if char_length(private.normalize_story_text(p_content)) not between 1 and 100 then
    raise exception 'content must be 1 to 100 characters'
      using errcode = '22023';
  end if;

  insert into public.stories (
    profile_id, status, content, background, link_url, published_at, expires_at
  ) values (
    caller_profile_id,
    'ready',
    private.normalize_story_text(p_content),
    p_background,
    nullif(private.normalize_story_text(p_link_url), ''),
    published,
    published + interval '24 hours'
  )
  returning id into created_id;

  return created_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_image_story (
  p_size_bytes bigint,
  p_width      integer,
  p_height     integer,
  p_content    text    DEFAULT ''::text,
  p_link_url   text    DEFAULT NULL::text
)
  RETURNS TABLE (
    story_id       bigint,
    object_path    text,
    thumbnail_path text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.story_writer_profile_id();
  path text := auth.uid()::text || '/' || gen_random_uuid()::text;
  thumbnail text := path || '-thumb';
  created_id bigint;
begin
  if char_length(private.normalize_story_text(p_content)) > 100 then
    raise exception 'content must be at most 100 characters'
      using errcode = '22023';
  end if;
  -- 클라이언트 압축 정책(`screen`)과 버킷 용량 제한을 그대로 옮긴다.
  if p_size_bytes is null or p_size_bytes not between 1 and 4194304
    or p_width is null or p_height is null
    or least(p_width, p_height) < 1 or greatest(p_width, p_height) > 2048 then
    raise exception 'invalid normalized story image metadata'
      using errcode = '22023';
  end if;

  insert into public.stories (
    profile_id, content, image_path, thumbnail_path, image_size_bytes, image_width,
    image_height, link_url
  ) values (
    caller_profile_id,
    private.normalize_story_text(p_content),
    path,
    thumbnail,
    p_size_bytes,
    p_width,
    p_height,
    nullif(private.normalize_story_text(p_link_url), '')
  )
  returning id into created_id;

  return query select created_id, path, thumbnail;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_image_story (
  p_story_id bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id uuid := auth.uid();
  story public.stories;
  object_record storage.objects;
  published timestamptz := now();
begin
  select item.*
  into story
  from public.stories as item
  join public.profiles as profile
    on profile.id = item.profile_id
  where item.id = p_story_id
    and profile.auth_user_id = caller_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
  for update of item;

  if story.id is null then
    raise exception 'story owner required' using errcode = '42501';
  end if;
  if story.status <> 'pending' then
    raise exception 'story is not pending' using errcode = '55000';
  end if;

  select object.*
  into object_record
  from storage.objects as object
  where object.bucket_id = 'story-media'
    and object.name = story.image_path;

  if object_record.id is null then
    raise exception 'uploaded object not found' using errcode = 'P0002';
  end if;
  if object_record.owner_id is distinct from caller_id::text then
    raise exception 'uploaded object owner does not match' using errcode = '42501';
  end if;
  if nullif(object_record.metadata ->> 'size', '')::bigint is distinct from story.image_size_bytes
    or object_record.metadata ->> 'mimetype' is distinct from 'image/webp' then
    raise exception 'uploaded object metadata does not match' using errcode = '22023';
  end if;

  -- 축소본은 크기를 미리 알리지 않지만 레일이 작성자마다 받는 파일이라 클라이언트 압축
  -- 정책(`card`)의 상한을 여기서도 지킨다. 넘으면 모든 뷰어의 홈이 무거워진다.
  if not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = 'story-media'
      and object.name = story.thumbnail_path
      and object.owner_id = caller_id::text
      and object.metadata ->> 'mimetype' = 'image/webp'
      and nullif(object.metadata ->> 'size', '')::bigint <= 524288
  ) then
    raise exception 'uploaded thumbnail not found' using errcode = 'P0002';
  end if;

  update public.stories
  set status = 'ready',
    published_at = published,
    expires_at = published + interval '24 hours'
  where id = story.id;
end;
$function$;

ALTER TABLE "public"."stories"
  ADD CONSTRAINT "stories_content_length" CHECK (((char_length(content) <= 100) AND (content !~ '^[[:space:]]'::text) AND (content !~ '[[:space:]]$'::text)));

ALTER TABLE "public"."stories"
  ADD CONSTRAINT "stories_kind_check" CHECK ((((image_path IS NOT NULL) AND (thumbnail_path IS NOT NULL) AND (background IS NULL) AND (image_size_bytes IS
    NOT NULL) AND (image_width > 0) AND (image_height > 0)) OR ((image_path IS NULL) AND (thumbnail_path IS NULL) AND (background IS
    NOT NULL) AND (image_size_bytes IS NULL) AND (image_width IS NULL) AND (image_height IS NULL) AND (content ~ '[^[:space:]]'::text))));

REVOKE ALL ON FUNCTION "private"."normalize_story_text"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."normalize_story_text"(text) TO "postgres";
