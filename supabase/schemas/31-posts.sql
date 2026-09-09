-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.


CREATE TYPE "public"."post_attachment_status" AS ENUM (
    'pending',
    'ready',
    'deleted'
);

ALTER TYPE "public"."post_attachment_status" OWNER TO "postgres";

CREATE TYPE "public"."post_identity" AS ENUM (
    'identified',
    'anonymous',
    'staff'
);

ALTER TYPE "public"."post_identity" OWNER TO "postgres";

CREATE TYPE "public"."post_kind" AS ENUM (
    'group',
    'profile'
);

ALTER TYPE "public"."post_kind" OWNER TO "postgres";

CREATE TYPE "public"."post_visibility" AS ENUM (
    'public',
    'private'
);

ALTER TYPE "public"."post_visibility" OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."apply_post_commit"("p_post_id" "uuid", "p_body" "text", "p_attachment_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  attachment_count integer := cardinality(coalesce(p_attachment_ids, '{}'::uuid[]));
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
$$;

ALTER FUNCTION "private"."apply_post_commit"("p_post_id" "uuid", "p_body" "text", "p_attachment_ids" "uuid"[]) OWNER TO "postgres";

-- 게시물을 실제로 지운다. 게시물 삭제는 세 곳(그룹 게시물, 개인 게시물, 그룹 삭제)에서 일어나고
-- 세 곳이 똑같은 순서를 지켜야 하므로 한곳에 모은다(삭제 및 보존 정책 §5.1).
--
-- 순서가 중요하다. 첨부와 댓글 이미지의 경로를 먼저 큐로 옮기지 않으면, CASCADE가 그 행을
-- 지우는 순간 object 경로를 다시 찾을 방법이 사라져 파일만 남는다.
CREATE OR REPLACE FUNCTION "private"."purge_posts"("p_post_ids" "uuid"[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  purged integer;
begin
  if p_post_ids is null or pg_catalog.cardinality(p_post_ids) = 0 then
    return 0;
  end if;

  -- 랭킹 이벤트도 함께 사라져야 한다. 그 CASCADE는 append-only 트리거를 거치므로 정리 경로임을
  -- 먼저 밝힌다(삭제 및 보존 정책 §7.4).
  perform pg_catalog.set_config('app.feed_event_purge', 'on', true);

  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select attachment.storage_bucket, attachment.object_path, 'post_attachment'
  from public.post_attachments as attachment
  where attachment.post_id = any(p_post_ids)
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
$$;

ALTER FUNCTION "private"."purge_posts"("p_post_ids" "uuid"[]) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."can_read_post"("p_post_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.current_profile_id() is not null
    and exists (
      select 1
      from public.posts as post
      where post.id = p_post_id
        and case
          -- 게시 전 초안은 첨부를 올리려는 작성자에게만 보인다.
          when post.published_at is null then private.is_post_author(post.id)
          when post.kind = 'group' then private.is_group_member(post.group_id)
          when post.visibility = 'public' then true
          -- 비공개 개인 게시물의 작성자는 CHECK상 타임라인 당사자와 같다.
          else private.is_post_author(post.id)
        end
    );
$$;

ALTER FUNCTION "private"."can_read_post"("p_post_id" "uuid") OWNER TO "postgres";




CREATE OR REPLACE FUNCTION "private"."is_post_author"("p_post_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select auth.uid() is not null
    and exists (
      select 1
      from private.post_authors as author
      where author.post_id = p_post_id
        and author.profile_id = private.current_profile_id()
    );
$$;

ALTER FUNCTION "private"."is_post_author"("p_post_id" "uuid") OWNER TO "postgres";

-- 본문에 실제로 남아 있는 멘션 ordinal. 수신자는 클라이언트가 준 목록이 아니라 **본문에서**
-- 파생한다 -- 그러지 않으면 본문에 없는 사람에게 알림을 보내게 할 수 있다.
CREATE OR REPLACE FUNCTION "private"."parse_mention_ordinals"("p_body" "text") RETURNS smallint[]
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select coalesce(
    array_agg(distinct (found.match[1])::smallint order by (found.match[1])::smallint),
    array[]::smallint[]
  )
  from regexp_matches(
    coalesce(p_body, ''), '\[@[^\]\n]*\]\(m:([0-9]{1,2})\)', 'g'
  ) as found(match);
$$;

ALTER FUNCTION "private"."parse_mention_ordinals"("p_body" "text") OWNER TO "postgres";

-- 본문의 멘션 토큰과 `public.post_mentions`를 맞춘다. 게시물의 본문 쓰기 경로는
-- `commit_group_post` 하나뿐이며, 본문과 대상이 어긋나지 않도록 언제나 함께 지나간다.
--
-- 수정 때마다 통째로 지우고 다시 넣는다. 알림 중복은 `emit_notification`의 event key가
-- 막으므로 이미 알린 사람은 조용하고 처음 등장한 사람만 새 알림을 받는다 -- "제거 후
-- 재추가에도 재알림 없음"(기능 명세 §8.14)이 같은 자리에서 나온다.
CREATE OR REPLACE FUNCTION "private"."sync_post_mentions"("p_post_id" "uuid", "p_body" "text", "p_mention_pub_ids" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  post_record public.posts;
  ordinals smallint[] := private.parse_mention_ordinals(p_body);
  already_mentioned bigint[];
  resolved_count integer;
begin
  select coalesce(array_agg(mention.profile_id), '{}'::bigint[])
  into already_mentioned
  from public.post_mentions as mention
  where mention.post_id = p_post_id;

  delete from public.post_mentions where post_id = p_post_id;
  if coalesce(array_length(ordinals, 1), 0) = 0 then
    return;
  end if;

  select post.* into post_record from public.posts as post where post.id = p_post_id;
  if post_record.kind <> 'group' then
    raise exception 'mentions are only available in group posts' using errcode = '22023';
  end if;
  -- 익명 뒤에서 특정인을 지목하지 못하게 막는다. 운영진 명의는 실제 작성자의 이름과 사진을
  -- 그대로 보여주므로(기능 명세 §8.6) 익명이 아니고, 여기서 막지 않는다.
  if post_record.author_identity = 'anonymous' then
    raise exception 'anonymous posts cannot mention members' using errcode = '42501';
  end if;
  if (select max(entry.ordinal) from unnest(ordinals) as entry(ordinal)) > 10 then
    raise exception 'a post can mention at most 10 members' using errcode = '22023';
  end if;

  -- 이미 불린 사람은 멤버십을 다시 묻지 않는다. 다시 물으면 멘션된 멤버가 그룹을 나간 뒤로는
  -- 제목 오타 하나 고치려 해도 저장이 막히고, 작성자가 본문에서 그 토큰을 손으로 찾아 지우는
  -- 수밖에 없다. 이미 나간 시점의 알림은 이미 갔고 칩은 프로필로 남는다 -- 새로 부르는
  -- 사람에게만 멤버십을 요구하면 충분하다.
  insert into public.post_mentions (post_id, ordinal, profile_id)
  select p_post_id, entry.ordinal, profile.id
  from unnest(ordinals) as entry(ordinal)
  join public.profiles as profile
    on lower(profile.pub_id) = lower(btrim(coalesce(p_mention_pub_ids[entry.ordinal], '')))
    and profile.status = 'accepted'
    and profile.deleted_at is null
  where profile.id = any(already_mentioned)
    or exists (
      select 1
      from public.group_memberships as membership
      where membership.group_id = post_record.group_id
        and membership.profile_id = profile.id
    );
  get diagnostics resolved_count = row_count;

  -- 토큰 하나가 남으면 화면에는 멘션이 보이는데 아무도 불리지 않는다. 조용히 흘리지 않고
  -- 통째로 되돌린다.
  if resolved_count <> array_length(ordinals, 1) then
    raise exception 'every mention must name a current group member' using errcode = '22023';
  end if;
end;
$$;

ALTER FUNCTION "private"."sync_post_mentions"("p_post_id" "uuid", "p_body" "text", "p_mention_pub_ids" "text"[]) OWNER TO "postgres";

-- 읽기 RPC가 본문 옆에 실어 보내는 표현용 멘션 목록. 이름은 저장된 토큰이 아니라 지금
-- 프로필에서 가져오므로 이름이 바뀌면 옛 글의 멘션도 함께 바뀐다. 탈퇴한 사용자는 이름을
-- 고정 문구로 바꾸고 pub_id를 비워 프로필 링크를 만들지 않는다(기능 명세 §10.3, §14.8).
CREATE OR REPLACE FUNCTION "private"."post_mentions_json"("p_post_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ordinal', mention.ordinal,
        'pub_id', profile.pub_id,
        'name', profile.name,
        'avatar_path', profile.avatar_path
      )
      order by mention.ordinal
    ),
    '[]'::jsonb
  )
  from public.post_mentions as mention
  left join public.profiles as profile on profile.id = mention.profile_id
    and profile.status = 'accepted' and profile.deleted_at is null
  where mention.post_id = p_post_id;
$$;

ALTER FUNCTION "private"."post_mentions_json"("p_post_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."prevent_post_immutable_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.id is distinct from old.id
    or new.kind is distinct from old.kind
    or new.group_id is distinct from old.group_id
    or new.timeline_profile_id is distinct from old.timeline_profile_id
    or (
      (
        new.author_identity is distinct from old.author_identity
        or new.display_author_profile_id is distinct from old.display_author_profile_id
      )
      and not (
        current_setting('app.update_group_post_draft_identity', true) = old.id::text
        and old.published_at is null
        and old.kind = 'group'
        and old.activity_kind is null
      )
    )
    or new.body_format_version is distinct from old.body_format_version
    or new.activity_kind is distinct from old.activity_kind
    or new.activity_media_path is distinct from old.activity_media_path
    or new.created_at is distinct from old.created_at
    or (
      new.visibility is distinct from old.visibility
      and not (
        current_setting('app.commit_post', true) = '1'
        and old.kind = 'profile'
        and old.activity_kind is null
        and new.visibility is not null
      )
    )
    or (
      new.published_at is distinct from old.published_at
      and not (old.published_at is null and new.published_at is not null)
    ) then
    raise exception 'post identity and publication fields cannot be changed'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

ALTER FUNCTION "private"."prevent_post_immutable_changes"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."prevent_profile_activity_attachments"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if exists (
    select 1
    from public.posts as post
    where post.id = new.post_id
      and post.activity_kind is not null
  ) then
    raise exception 'profile activity posts cannot have attachments'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

ALTER FUNCTION "private"."prevent_profile_activity_attachments"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."validate_profile_activity_path"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  owner_auth_user_id uuid;
  media_slot text;
begin
  if new.activity_kind is null then
    return new;
  end if;

  select profile.auth_user_id
  into owner_auth_user_id
  from public.profiles as profile
  where profile.id = new.timeline_profile_id;

  media_slot := case new.activity_kind
    when 'avatar_changed' then 'avatar'
    when 'cover_changed' then 'cover'
  end;

  if owner_auth_user_id is null
    or new.activity_media_path !~ (
      '^' || owner_auth_user_id::text || '/' || media_slot
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
  then
    raise exception 'profile activity media path must belong to the timeline owner'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

ALTER FUNCTION "private"."validate_profile_activity_path"() OWNER TO "postgres";



CREATE TABLE IF NOT EXISTS "public"."group_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "position" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "group_categories_name_length" CHECK ((("char_length"("btrim"("name")) >= 1) AND ("char_length"("btrim"("name")) <= 30))),
    CONSTRAINT "group_categories_position_nonnegative" CHECK (("position" >= 0))
);

ALTER TABLE "public"."group_categories" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."post_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "storage_bucket" "text" DEFAULT 'post-attachments'::"text" NOT NULL,
    "object_path" "text" NOT NULL,
    "original_filename" "text" NOT NULL,
    "position" integer NOT NULL,
    "mime_type" "text" NOT NULL,
    "size_bytes" bigint NOT NULL,
    "width" integer,
    "height" integer,
    "status" "public"."post_attachment_status" DEFAULT 'pending'::"public"."post_attachment_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ready_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "post_attachments_bucket_check" CHECK (("storage_bucket" = 'post-attachments'::"text")),
    CONSTRAINT "post_attachments_dimensions_check" CHECK (("width" IS NULL AND "height" IS NULL) OR ("width" BETWEEN 1 AND 100000 AND "height" BETWEEN 1 AND 100000)),
    CONSTRAINT "post_attachments_filename_check" CHECK ((("char_length"("btrim"("original_filename")) >= 1) AND ("char_length"("btrim"("original_filename")) <= 255))),
    CONSTRAINT "post_attachments_mime_check" CHECK ((("char_length"("btrim"("mime_type")) >= 1) AND ("char_length"("btrim"("mime_type")) <= 255))),
    CONSTRAINT "post_attachments_path_check" CHECK (("object_path" = ((("post_id")::"text" || '/'::"text") || ("id")::"text"))),
    CONSTRAINT "post_attachments_position_check" CHECK ((("position" >= '-30'::integer) AND ("position" <= 29))),
    CONSTRAINT "post_attachments_size_check" CHECK ((("size_bytes" >= 1) AND ("size_bytes" <= 31457280))),
    CONSTRAINT "post_attachments_status_timestamps_check" CHECK (((("status" = 'pending'::"public"."post_attachment_status") AND ("ready_at" IS NULL) AND ("deleted_at" IS NULL)) OR (("status" = 'ready'::"public"."post_attachment_status") AND ("ready_at" IS NOT NULL) AND ("deleted_at" IS NULL)) OR (("status" = 'deleted'::"public"."post_attachment_status") AND ("deleted_at" IS NOT NULL))))
);

ALTER TABLE "public"."post_attachments" OWNER TO "postgres";

-- 멘션 대상의 정본(기능 명세 §8.14). 본문에는 `[@이름](m:<ordinal>)` 토큰만 남고 누구를
-- 부른 것인지는 여기에만 있다. 본문에 pub_id를 박지 않는 이유는 pub_id가 바뀔 수 있고
-- 놓아준 값을 남이 다시 쓸 수 있기 때문이다(기능 명세 §12.2) -- 박아 두면 오래된 멘션이
-- 조용히 다른 사람을 가리킨다. `ordinal`은 그 본문 안에서만 뜻이 있는 라벨이라 내부 프로필
-- ID가 본문으로 새지 않는다. 같은 사람을 두 번 불러도 ordinal 하나를 함께 쓰므로
-- ordinal 상한 10이 곧 "최대 10명"이다.
CREATE TABLE IF NOT EXISTS "public"."post_mentions" (
    "post_id" "uuid" NOT NULL,
    "ordinal" smallint NOT NULL,
    "profile_id" bigint NOT NULL,
    CONSTRAINT "post_mentions_ordinal_range" CHECK ((("ordinal" >= 1) AND ("ordinal" <= 10)))
);

ALTER TABLE "public"."post_mentions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "private"."post_authors" (
    "post_id" "uuid" NOT NULL,
    "profile_id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "private"."post_authors" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kind" "public"."post_kind" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "body_format_version" smallint DEFAULT 1 NOT NULL,
    "group_id" "uuid",
    "timeline_profile_id" bigint,
    "title" "text",
    "search_text" "text" GENERATED ALWAYS AS ("lower"("regexp_replace"(((COALESCE("title", ''::"text") || ' '::"text") || "body"), '[[:space:]]+'::"text", ''::"text", 'g'::"text"))) STORED,
    "category_id" "uuid",
    "author_identity" "public"."post_identity" NOT NULL,
    "display_author_profile_id" bigint,
    "visibility" "public"."post_visibility",
    "pinned_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published_at" timestamp with time zone,
    "edited_at" timestamp with time zone,
    "comment_count" integer DEFAULT 0 NOT NULL,
    "activity_kind" "public"."profile_media_activity_kind",
    "activity_media_path" "text",
    CONSTRAINT "posts_body_format_version_supported" CHECK (("body_format_version" = 1)),
    CONSTRAINT "posts_body_length" CHECK (("char_length"("body") <= 20000)),
    CONSTRAINT "posts_comment_count_nonnegative" CHECK (("comment_count" >= 0)),
    CONSTRAINT "posts_display_author_shape" CHECK (((("author_identity" = 'identified'::"public"."post_identity") AND ("display_author_profile_id" IS NOT NULL)) OR (("author_identity" = ANY (ARRAY['anonymous'::"public"."post_identity", 'staff'::"public"."post_identity"])) AND ("display_author_profile_id" IS NULL)))),
    CONSTRAINT "posts_kind_shape" CHECK (((("kind" = 'group'::"public"."post_kind") AND ("group_id" IS NOT NULL) AND ("timeline_profile_id" IS NULL) AND ("title" IS NOT NULL) AND ("visibility" IS NULL)) OR (("kind" = 'profile'::"public"."post_kind") AND ("group_id" IS NULL) AND ("timeline_profile_id" IS NOT NULL) AND ("title" IS NULL) AND ("category_id" IS NULL) AND ("author_identity" = 'identified'::"public"."post_identity") AND ("visibility" IS NOT NULL) AND ("pinned_at" IS NULL)))),
    CONSTRAINT "posts_private_profile_owner" CHECK ((("kind" <> 'profile'::"public"."post_kind") OR ("visibility" <> 'private'::"public"."post_visibility") OR ("display_author_profile_id" = "timeline_profile_id"))),
    CONSTRAINT "posts_profile_activity_pair" CHECK ((("activity_kind" IS NULL) = ("activity_media_path" IS NULL))),
    CONSTRAINT "posts_profile_activity_shape" CHECK ((("activity_kind" IS NULL) OR (("kind" = 'profile'::"public"."post_kind") AND ("timeline_profile_id" = "display_author_profile_id") AND ("visibility" = 'public'::"public"."post_visibility") AND ("body" = ''::"text") AND ("published_at" IS NOT NULL) AND ("activity_media_path" ~ (('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'::"text" ||
CASE "activity_kind"
    WHEN 'avatar_changed'::"public"."profile_media_activity_kind" THEN 'avatar'::"text"
    WHEN 'cover_changed'::"public"."profile_media_activity_kind" THEN 'cover'::"text"
    ELSE NULL::"text"
END) || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::"text"))))),
    CONSTRAINT "posts_publication_timestamps" CHECK (((("published_at" IS NULL) OR ("published_at" >= "created_at")) AND (("edited_at" IS NULL) OR (("published_at" IS NOT NULL) AND ("edited_at" >= "published_at"))) AND (("pinned_at" IS NULL) OR (("published_at" IS NOT NULL) AND ("pinned_at" >= "published_at"))))),
    CONSTRAINT "posts_title_length" CHECK ((("title" IS NULL) OR (("char_length"("btrim"("title")) >= 1) AND ("char_length"("btrim"("title")) <= 100))))
);

ALTER TABLE "public"."posts" OWNER TO "postgres";

ALTER TABLE ONLY "private"."post_authors"
    ADD CONSTRAINT "post_authors_pkey" PRIMARY KEY ("post_id");

ALTER TABLE ONLY "public"."group_categories"
    ADD CONSTRAINT "group_categories_id_group_id_key" UNIQUE ("id", "group_id");

ALTER TABLE ONLY "public"."group_categories"
    ADD CONSTRAINT "group_categories_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."post_attachments"
    ADD CONSTRAINT "post_attachments_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."post_mentions"
    ADD CONSTRAINT "post_mentions_pkey" PRIMARY KEY ("post_id", "ordinal");

ALTER TABLE ONLY "public"."post_attachments"
    ADD CONSTRAINT "post_attachments_storage_bucket_object_path_key" UNIQUE ("storage_bucket", "object_path");

ALTER TABLE ONLY "public"."posts"
    ADD CONSTRAINT "posts_pkey" PRIMARY KEY ("id");

CREATE INDEX "post_authors_profile_idx" ON "private"."post_authors" USING "btree" ("profile_id", "post_id");

CREATE UNIQUE INDEX "group_categories_name_unique_idx" ON "public"."group_categories" USING "btree" ("group_id", "lower"("btrim"("name")));

CREATE INDEX "group_categories_order_idx" ON "public"."group_categories" USING "btree" ("group_id", "position", "id");

CREATE UNIQUE INDEX "post_attachments_active_position_idx" ON "public"."post_attachments" USING "btree" ("post_id", "position") WHERE ("status" <> 'deleted'::"public"."post_attachment_status");

CREATE INDEX "post_attachments_cleanup_idx" ON "public"."post_attachments" USING "btree" ("created_at", "id") WHERE ("status" = ANY (ARRAY['pending'::"public"."post_attachment_status", 'deleted'::"public"."post_attachment_status"]));

CREATE UNIQUE INDEX "post_mentions_target_idx" ON "public"."post_mentions" USING "btree" ("post_id", "profile_id");

CREATE INDEX "post_attachments_post_list_idx" ON "public"."post_attachments" USING "btree" ("post_id", "position", "id") WHERE ("status" = 'ready'::"public"."post_attachment_status");

CREATE INDEX "posts_category_recent_idx" ON "public"."posts" USING "btree" ("group_id", "category_id", "published_at" DESC, "id" DESC) WHERE (("kind" = 'group'::"public"."post_kind") AND ("category_id" IS NOT NULL) AND ("published_at" IS NOT NULL));

CREATE INDEX "posts_display_author_idx" ON "public"."posts" USING "btree" ("display_author_profile_id", "published_at" DESC, "id" DESC) WHERE ("display_author_profile_id" IS NOT NULL);

CREATE INDEX "posts_group_pinned_idx" ON "public"."posts" USING "btree" ("group_id", "published_at" DESC, "id" DESC) WHERE (("kind" = 'group'::"public"."post_kind") AND ("pinned_at" IS NOT NULL));

CREATE INDEX "posts_group_recent_idx" ON "public"."posts" USING "btree" ("group_id", "published_at" DESC, "id" DESC) WHERE (("kind" = 'group'::"public"."post_kind") AND ("published_at" IS NOT NULL));

CREATE INDEX "posts_group_search_idx" ON "public"."posts" USING "gin" ("search_text" "extensions"."gin_trgm_ops") WHERE (("kind" = 'group'::"public"."post_kind") AND ("published_at" IS NOT NULL));

CREATE UNIQUE INDEX "posts_profile_activity_media_path_key" ON "public"."posts" USING "btree" ("activity_media_path") WHERE ("activity_media_path" IS NOT NULL);

CREATE INDEX "posts_public_profile_feed_idx" ON "public"."posts" USING "btree" ("published_at" DESC, "id" DESC) WHERE (("kind" = 'profile'::"public"."post_kind") AND ("visibility" = 'public'::"public"."post_visibility") AND ("published_at" IS NOT NULL));

CREATE INDEX "posts_timeline_idx" ON "public"."posts" USING "btree" ("timeline_profile_id", "published_at" DESC, "id" DESC) WHERE (("kind" = 'profile'::"public"."post_kind") AND ("published_at" IS NOT NULL));

CREATE OR REPLACE TRIGGER "group_categories_set_updated_at" BEFORE UPDATE ON "public"."group_categories" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();

CREATE OR REPLACE TRIGGER "post_attachments_prevent_profile_activity" BEFORE INSERT OR UPDATE OF "post_id" ON "public"."post_attachments" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_profile_activity_attachments"();

CREATE OR REPLACE TRIGGER "posts_prevent_immutable_changes" BEFORE UPDATE ON "public"."posts" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_post_immutable_changes"();

CREATE OR REPLACE TRIGGER "posts_validate_profile_activity_path" BEFORE INSERT ON "public"."posts" FOR EACH ROW EXECUTE FUNCTION "private"."validate_profile_activity_path"();

ALTER TABLE ONLY "private"."post_authors"
    ADD CONSTRAINT "post_authors_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "private"."post_authors"
    ADD CONSTRAINT "post_authors_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");

ALTER TABLE ONLY "public"."group_categories"
    ADD CONSTRAINT "group_categories_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."post_attachments"
    ADD CONSTRAINT "post_attachments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."post_mentions"
    ADD CONSTRAINT "post_mentions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."post_mentions"
    ADD CONSTRAINT "post_mentions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."posts"
    ADD CONSTRAINT "posts_category_group_fkey" FOREIGN KEY ("category_id", "group_id") REFERENCES "public"."group_categories"("id", "group_id") ON DELETE SET NULL ("category_id");

ALTER TABLE ONLY "public"."posts"
    ADD CONSTRAINT "posts_display_author_profile_id_fkey" FOREIGN KEY ("display_author_profile_id") REFERENCES "public"."profiles"("id");

ALTER TABLE ONLY "public"."posts"
    ADD CONSTRAINT "posts_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id");

ALTER TABLE ONLY "public"."posts"
    ADD CONSTRAINT "posts_timeline_profile_id_fkey" FOREIGN KEY ("timeline_profile_id") REFERENCES "public"."profiles"("id");

ALTER TABLE "private"."post_authors" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_authors_deny_client_access" ON "private"."post_authors" USING (false) WITH CHECK (false);

ALTER TABLE "public"."group_categories" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_categories_select_member" ON "public"."group_categories" FOR SELECT TO "authenticated" USING ("private"."is_group_member"("group_id"));

ALTER TABLE "public"."post_attachments" ENABLE ROW LEVEL SECURITY;

-- 본문 토큰과 함께 읽어야 뜻이 서므로 직접 select를 열지 않는다. 읽기는 게시물 읽기 RPC가
-- 돌려주는 `mentions`로만 나간다.
ALTER TABLE "public"."post_mentions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_mentions_deny_client_access" ON "public"."post_mentions" USING (false) WITH CHECK (false);


CREATE POLICY "post_attachments_select_reader" ON "public"."post_attachments" FOR SELECT TO "authenticated" USING ((("status" <> 'deleted'::"public"."post_attachment_status") AND (("status" = 'ready'::"public"."post_attachment_status") OR "private"."is_post_author"("post_id")) AND "private"."can_read_post"("post_id")));

ALTER TABLE "public"."posts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "posts_select_readable" ON "public"."posts" FOR SELECT TO "authenticated" USING ("private"."can_read_post"("id"));

REVOKE ALL ON FUNCTION "private"."apply_post_commit"("p_post_id" "uuid", "p_body" "text", "p_attachment_ids" "uuid"[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."can_read_post"("p_post_id" "uuid") FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."purge_posts"("p_post_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_read_post"("p_post_id" "uuid") TO "authenticated";




REVOKE ALL ON FUNCTION "private"."is_post_author"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_post_author"("p_post_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "private"."parse_mention_ordinals"("p_body" "text") FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."sync_post_mentions"("p_post_id" "uuid", "p_body" "text", "p_mention_pub_ids" "text"[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."post_mentions_json"("p_post_id" "uuid") FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."prevent_post_immutable_changes"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."prevent_profile_activity_attachments"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."validate_profile_activity_path"() FROM PUBLIC;



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."group_categories" TO "service_role";
GRANT SELECT ON TABLE "public"."group_categories" TO "authenticated";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."post_attachments" TO "service_role";
GRANT SELECT ON TABLE "public"."post_attachments" TO "authenticated";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."post_mentions" TO "service_role";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."posts" TO "service_role";
GRANT SELECT ON TABLE "public"."posts" TO "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."group_categories" FROM "anon", "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."posts" FROM "anon", "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."post_attachments" FROM "anon", "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."post_mentions" FROM "anon", "authenticated";
