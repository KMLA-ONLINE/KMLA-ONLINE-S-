SET local check_function_bodies = off;

DROP FUNCTION "public"."create_text_story"(text, text, text, jsonb);

DROP FUNCTION "public"."list_active_stories"();

DROP FUNCTION "public"."prepare_image_story"(bigint, integer, integer, text, text, jsonb);

CREATE TYPE "public"."story_audience" AS ENUM (
  'everyone',
  'students',
  'cohort'
);

ALTER TABLE "public"."stories"
  ADD COLUMN "audience" public.story_audience NOT NULL DEFAULT 'everyone'::public.story_audience;

-- 생성된 순서를 손봤다. 판정 함수를 그것을 부르는 함수보다 먼저 만들어야 schemas와 같은
-- 스키마로 비교된다. 순서가 다르면 drift 검사가 스토리 함수 전체를 다시 만들라고 한다.
CREATE OR REPLACE FUNCTION private.shares_cohort (
  p_cohort          smallint,
  p_returning       boolean,
  p_other_cohort    smallint,
  p_other_returning boolean
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select coalesce(
    p_cohort = p_other_cohort
      or (p_returning and p_cohort + 1 = p_other_cohort)
      or (p_other_returning and p_other_cohort + 1 = p_cohort),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION private.story_visible_to (
  p_audience         public.story_audience,
  p_author_type      public.profile_type,
  p_author_cohort    smallint,
  p_author_returning boolean,
  p_viewer_type      public.profile_type,
  p_viewer_cohort    smallint,
  p_viewer_returning boolean
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select case
    when p_author_type = 'teacher' then true
    when p_author_type <> 'student' then false
    when p_audience = 'everyone' then p_viewer_type in ('student', 'teacher')
    when p_viewer_type <> 'student' then false
    when p_audience = 'students' then true
    else private.shares_cohort(
      p_author_cohort, p_author_returning, p_viewer_cohort, p_viewer_returning
    )
  end;
$function$;

CREATE OR REPLACE FUNCTION private.check_story_audience (
  p_profile_id bigint,
  p_audience   public.story_audience
)
  RETURNS public.story_audience
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if p_audience is null then
    return 'everyone';
  end if;

  if p_audience <> 'everyone' and not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_profile_id
      and profile.type = 'student'
  ) then
    raise exception 'only students can narrow a story audience'
      using errcode = '22023';
  end if;

  return p_audience;
end;
$function$;

CREATE OR REPLACE FUNCTION private.can_read_story (
  p_story_id bigint
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.stories as story
    join public.profiles as author
      on author.id = story.profile_id
      and author.status = 'accepted'
      and author.deleted_at is null
    join public.profiles as viewer
      on viewer.auth_user_id = auth.uid()
      and viewer.status = 'accepted'
      and viewer.deleted_at is null
      and not private.profile_suspended(viewer.id)
    where story.id = p_story_id
      and story.status = 'ready'
      and story.expires_at > now()
      and private.story_visible_to(
        story.audience,
        author.type, author.cohort, author.is_returning_student,
        viewer.type, viewer.cohort, viewer.is_returning_student
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_read_story_media (
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
    from public.stories as story
    where p_object_path in (story.image_path, story.thumbnail_path)
      and private.can_read_story(story.id)
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_upload_story_media (
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
    from public.stories as story
    join public.profiles as profile on profile.id = story.profile_id
    where p_object_path in (story.image_path, story.thumbnail_path)
      and story.status = 'pending'
      and profile.auth_user_id = auth.uid()
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and not private.profile_suspended(profile.id)
  );
$function$;



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



CREATE OR REPLACE FUNCTION private.story_audience_profile_id (
  p_story_id bigint
)
  RETURNS bigint
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  viewer_id bigint;
  author_id bigint;
begin
  if not private.can_read_story(p_story_id) then
    raise exception 'story not found' using errcode = 'P0002';
  end if;

  select profile.id
  into viewer_id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid();

  select story.profile_id
  into author_id
  from public.stories as story
  where story.id = p_story_id;

  return nullif(viewer_id, author_id);
end;
$function$;



CREATE OR REPLACE FUNCTION private.story_writer_profile_id()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint;
  active_count integer;
begin
  -- 쓰기는 재학생과 교사만 한다. 졸업생은 읽기만 하며, 그중에서도 교사 스토리만 본다
  -- (기능 명세 §17.6). 프로필 행을 잠가 동시에 올린 스토리가 상한을 함께 넘지 못하게 한다.
  select profile.id
  into caller_profile_id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id)
    and profile.type in ('student', 'teacher')
  -- `no key update`면 상한 검사끼리는 순서가 잡히면서도, 이 프로필을 참조하는 다른 행의 외래
  -- 키 검사(`key share`)는 막지 않는다.
  for no key update;

  if caller_profile_id is null then
    raise exception 'student or teacher profile required'
      using errcode = '42501';
  end if;

  select count(*)
  into active_count
  from public.stories as story
  where story.profile_id = caller_profile_id
    and (
      (story.status = 'ready' and story.expires_at > now())
      -- 미완성 업로드는 정리 작업이 지우는 48시간 동안 센다. 24시간만 세면 그 사이에 한도를
      -- 다시 채워 회수되지 않은 행을 두 배로 쌓을 수 있다.
      or (story.status = 'pending' and story.created_at > now() - interval '48 hours')
    );

  if active_count >= 20 then
    raise exception 'too many active stories'
      using errcode = '54000';
  end if;

  return caller_profile_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_text_story (
  p_content    text,
  p_background text,
  p_link_url   text                  DEFAULT NULL::text,
  p_layout     jsonb                 DEFAULT NULL::jsonb,
  p_audience   public.story_audience DEFAULT 'everyone'::public.story_audience
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
    profile_id, status, content, background, link_url, layout, audience, published_at,
    expires_at
  ) values (
    caller_profile_id,
    'ready',
    private.normalize_story_text(p_content),
    p_background,
    nullif(private.normalize_story_text(p_link_url), ''),
    p_layout,
    private.check_story_audience(caller_profile_id, p_audience),
    published,
    published + interval '24 hours'
  )
  returning id into created_id;

  return created_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."create_text_story"(text, text, text, jsonb, public.story_audience) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.delete_my_story (
  p_story_id bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  found_count integer;
begin
  with deleted as (
    delete from public.stories as story
    using public.profiles as profile
    where story.id = p_story_id
      and profile.id = story.profile_id
      and profile.auth_user_id = auth.uid()
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and not private.profile_suspended(profile.id)
    returning story.image_path, story.thumbnail_path
  ), queued as (
    insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
    select 'story-media', path.object_path, 'story_media'
    from deleted
    cross join lateral (
      values (deleted.image_path), (deleted.thumbnail_path)
    ) as path(object_path)
    where path.object_path is not null
    on conflict (bucket, object_path) do update
      set dry_run = queue.dry_run and excluded.dry_run
  )
  select count(*) into found_count from deleted;

  if found_count = 0 then
    raise exception 'story owner required' using errcode = '42501';
  end if;
end;
$function$;

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
    layout         jsonb,
    audience       public.story_audience
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with viewer as (
    select profile.type, profile.cohort, profile.is_returning_student
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
        and private.shares_cohort(
          author.cohort, author.is_returning_student,
          viewer.cohort, viewer.is_returning_student
        ) as same_cohort
    from viewer
    cross join public.stories as story
    join public.profiles as author
      on author.id = story.profile_id
      and author.status = 'accepted'
      and author.deleted_at is null
    where story.status = 'ready'
      and story.expires_at > now()
      -- private.can_read_story와 같은 판정이다. 값만 받는 함수라 행마다 조회하지 않는다.
      and private.story_visible_to(
        story.audience,
        author.type, author.cohort, author.is_returning_student,
        viewer.type, viewer.cohort, viewer.is_returning_student
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
    visible.layout,
    visible.audience
  from visible
  order by
    visible.same_cohort desc,
    max(visible.published_at) over (partition by visible.profile_id) desc,
    visible.profile_id,
    visible.published_at,
    visible.id;
$function$;

REVOKE ALL ON FUNCTION "public"."list_active_stories"() FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.list_story_viewers (
  p_story_id bigint
)
  RETURNS TABLE (
    pub_id      text,
    name        text,
    avatar_path text,
    viewed_at   timestamp with time zone,
    reactions   public.post_reaction[]
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not exists (
    select 1
    from public.stories as story
    join public.profiles as author
      on author.id = story.profile_id
    where story.id = p_story_id
      and author.auth_user_id = auth.uid()
      and author.status = 'accepted'
      and author.deleted_at is null
      and not private.profile_suspended(author.id)
  ) then
    raise exception 'story owner required' using errcode = '42501';
  end if;

  return query
  select
    viewer.pub_id,
    viewer.name,
    viewer.avatar_path,
    seen.viewed_at,
    coalesce(
      array_agg(reaction.reaction order by reaction.created_at, reaction.id)
        filter (where reaction.id is not null),
      array[]::public.post_reaction[]
    )
  from public.story_views as seen
  join public.profiles as viewer
    on viewer.id = seen.profile_id
    and viewer.status = 'accepted'
    and viewer.deleted_at is null
  left join public.story_reactions as reaction
    on reaction.story_id = seen.story_id
    and reaction.profile_id = seen.profile_id
  where seen.story_id = p_story_id
  group by viewer.id, seen.viewed_at
  order by greatest(seen.viewed_at, max(reaction.created_at)) desc, viewer.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_story_viewed (
  p_story_id bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  viewer_id bigint := private.story_audience_profile_id(p_story_id);
begin
  if viewer_id is null then
    return;
  end if;

  insert into public.story_views (story_id, profile_id)
  values (p_story_id, viewer_id)
  on conflict do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_image_story (
  p_size_bytes bigint,
  p_width      integer,
  p_height     integer,
  p_content    text                  DEFAULT ''::text,
  p_link_url   text                  DEFAULT NULL::text,
  p_layout     jsonb                 DEFAULT NULL::jsonb,
  p_audience   public.story_audience DEFAULT 'everyone'::public.story_audience
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
    image_height, link_url, layout, audience
  ) values (
    caller_profile_id,
    private.normalize_story_text(p_content),
    path,
    thumbnail,
    p_size_bytes,
    p_width,
    p_height,
    nullif(private.normalize_story_text(p_link_url), ''),
    p_layout,
    private.check_story_audience(caller_profile_id, p_audience)
  )
  returning id into created_id;

  return query select created_id, path, thumbnail;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."prepare_image_story"(bigint, integer, integer, text, text, jsonb, public.story_audience) FROM PUBLIC, "anon", "service_role";

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
    and not private.profile_suspended(profile.id)
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

CREATE OR REPLACE FUNCTION public.send_story_reaction (
  p_story_id bigint,
  p_reaction public.post_reaction
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  viewer_id bigint := private.story_audience_profile_id(p_story_id);
  sent_count integer;
begin
  if viewer_id is null then
    raise exception 'cannot react to an own story' using errcode = '42501';
  end if;

  insert into public.story_views (story_id, profile_id)
  values (p_story_id, viewer_id)
  on conflict do nothing;

  -- 같은 사람이 동시에 보낸 반응이 상한을 함께 넘지 않도록 본 기록을 잠그고 센다.
  perform 1
  from public.story_views as seen
  where seen.story_id = p_story_id
    and seen.profile_id = viewer_id
  for update;

  select count(*)
  into sent_count
  from public.story_reactions as reaction
  where reaction.story_id = p_story_id
    and reaction.profile_id = viewer_id;

  if sent_count >= 30 then
    raise exception 'too many story reactions' using errcode = '54000';
  end if;

  insert into public.story_reactions (story_id, profile_id, reaction)
  values (p_story_id, viewer_id, p_reaction);
end;
$function$;

REVOKE ALL ON FUNCTION "private"."check_story_audience"(bigint, public.story_audience) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."shares_cohort"(smallint, boolean, smallint, boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."story_visible_to"(public.story_audience, public.profile_type, smallint, boolean, public.profile_type, smallint, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."create_text_story"(text, text, text, jsonb, public.story_audience) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."create_text_story"(text, text, text, jsonb, public.story_audience) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_text_story"(text, text, text, jsonb, public.story_audience) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_active_stories"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_active_stories"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_active_stories"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."prepare_image_story"(bigint, integer, integer, text, text, jsonb, public.story_audience) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."prepare_image_story"(bigint, integer, integer, text, text, jsonb, public.story_audience) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."prepare_image_story"(bigint, integer, integer, text, text, jsonb, public.story_audience) TO "postgres";
