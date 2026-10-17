SET local check_function_bodies = off;

DROP FUNCTION "public"."create_text_story"(text, text, text);

DROP FUNCTION "public"."list_active_stories"();

DROP FUNCTION "public"."prepare_image_story"(bigint, integer, integer, text, text);

ALTER TABLE "public"."stories"
  ADD COLUMN "layout" jsonb;

CREATE OR REPLACE FUNCTION private.is_story_layout (
  p_layout jsonb
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select case
    when pg_catalog.jsonb_typeof(p_layout) <> 'object' then false
    when (p_layout - array['text', 'link']) <> '{}'::jsonb then false
    else not exists (
      select 1
      from pg_catalog.jsonb_each(p_layout) as item(key, value)
      where not case
        when pg_catalog.jsonb_typeof(item.value) <> 'object' then false
        when (item.value - array['x', 'y', 'scale']) <> '{}'::jsonb then false
        when pg_catalog.jsonb_typeof(item.value -> 'x') is distinct from 'number'
          or pg_catalog.jsonb_typeof(item.value -> 'y') is distinct from 'number'
          or pg_catalog.jsonb_typeof(item.value -> 'scale') is distinct from 'number'
          then false
        else (item.value ->> 'x')::numeric between 0 and 1
          and (item.value ->> 'y')::numeric between 0 and 1
          and (item.value ->> 'scale')::numeric between 0.5 and 2.5
      end
    )
  end;
$function$;

CREATE OR REPLACE FUNCTION public.create_text_story (
  p_content    text,
  p_background text,
  p_link_url   text  DEFAULT NULL::text,
  p_layout     jsonb DEFAULT NULL::jsonb
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
    profile_id, status, content, background, link_url, layout, published_at, expires_at
  ) values (
    caller_profile_id,
    'ready',
    private.normalize_story_text(p_content),
    p_background,
    nullif(private.normalize_story_text(p_link_url), ''),
    p_layout,
    published,
    published + interval '24 hours'
  )
  returning id into created_id;

  return created_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."create_text_story"(text, text, text, jsonb) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.list_active_stories()
  RETURNS TABLE (
    story_id       bigint,
    pub_id         text,
    name           text,
    avatar_path    text,
    content        text,
    background     text,
    image_path     text,
    thumbnail_path text,
    image_width    integer,
    image_height   integer,
    link_url       text,
    published_at   timestamp with time zone,
    layout         jsonb
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with viewer as (
    select profile.type, profile.cohort
    from public.profiles as profile
    where profile.auth_user_id = auth.uid()
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and not private.profile_suspended(profile.id)
  ), visible as (
    select
      story.*,
      author.pub_id,
      author.name,
      author.avatar_path,
      viewer.type = 'student'
        and author.type = 'student'
        and author.cohort = viewer.cohort as same_cohort
    from viewer
    cross join public.stories as story
    join public.profiles as author
      on author.id = story.profile_id
      and author.status = 'accepted'
      and author.deleted_at is null
    where story.status = 'ready'
      and story.expires_at > now()
      -- private.can_read_story와 같은 판정이다. 행마다 그 함수를 부르지 않으려고 풀어 쓴다.
      and (
        author.type = 'teacher'
        or (author.type = 'student' and viewer.type in ('student', 'teacher'))
      )
  )
  select
    visible.id,
    visible.pub_id,
    visible.name,
    visible.avatar_path,
    visible.content,
    visible.background,
    visible.image_path,
    visible.thumbnail_path,
    visible.image_width,
    visible.image_height,
    visible.link_url,
    visible.published_at,
    visible.layout
  from visible
  order by
    visible.same_cohort desc,
    max(visible.published_at) over (partition by visible.profile_id) desc,
    visible.profile_id,
    visible.published_at,
    visible.id;
$function$;

REVOKE ALL ON FUNCTION "public"."list_active_stories"() FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.prepare_image_story (
  p_size_bytes bigint,
  p_width      integer,
  p_height     integer,
  p_content    text    DEFAULT ''::text,
  p_link_url   text    DEFAULT NULL::text,
  p_layout     jsonb   DEFAULT NULL::jsonb
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
    image_height, link_url, layout
  ) values (
    caller_profile_id,
    private.normalize_story_text(p_content),
    path,
    thumbnail,
    p_size_bytes,
    p_width,
    p_height,
    nullif(private.normalize_story_text(p_link_url), ''),
    p_layout
  )
  returning id into created_id;

  return query select created_id, path, thumbnail;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."prepare_image_story"(bigint, integer, integer, text, text, jsonb) FROM PUBLIC, "anon", "service_role";

REVOKE ALL ON FUNCTION "private"."is_story_layout"(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."create_text_story"(text, text, text, jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."create_text_story"(text, text, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_text_story"(text, text, text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_active_stories"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_active_stories"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_active_stories"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."prepare_image_story"(bigint, integer, integer, text, text, jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."prepare_image_story"(bigint, integer, integer, text, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."prepare_image_story"(bigint, integer, integer, text, text, jsonb) TO "postgres";

ALTER TABLE "public"."stories"
  ADD CONSTRAINT "stories_layout_check"
    CHECK (((layout IS NULL) OR (private.is_story_layout(layout) AND ((NOT (layout ? 'text'::text)) OR (content <> ''::text)) AND ((NOT (layout ? 'link'::text)) OR (link_url IS
    NOT NULL)))));
