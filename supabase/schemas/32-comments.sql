-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.


CREATE TYPE "public"."comment_image_status" AS ENUM (
    'pending',
    'finalized',
    'ready',
    'deleted'
);

ALTER TYPE "public"."comment_image_status" OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."can_read_comment_image_object"("p_storage_bucket" "text", "p_object_path" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.comment_images as image
    join public.post_comments as comment on comment.id = image.comment_id
    where image.storage_bucket = p_storage_bucket
      and image.object_path = p_object_path
      and image.status = 'ready'
      and comment.deleted_at is null
      and private.can_read_post(image.post_id)
  );
$$;

ALTER FUNCTION "private"."can_read_comment_image_object"("p_storage_bucket" "text", "p_object_path" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."can_upload_comment_image_object"("p_storage_bucket" "text", "p_object_path" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.comment_images as image
    where image.storage_bucket = p_storage_bucket
      and image.object_path = p_object_path
      and image.status = 'pending'
      and private.is_comment_image_uploader(image.id)
      and private.can_read_post(image.post_id)
  );
$$;

ALTER FUNCTION "private"."can_upload_comment_image_object"("p_storage_bucket" "text", "p_object_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."comment_author_label"("p_identity" "public"."post_identity", "p_alias" smallint, "p_name" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case p_identity
    when 'identified' then p_name
    when 'staff' then '운영진'
    when 'anonymous' then
      case when p_alias = 0 then '글쓴이' else '익명' || p_alias::text end
  end;
$$;

ALTER FUNCTION "private"."comment_author_label"("p_identity" "public"."post_identity", "p_alias" smallint, "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_comment_image_uploader"("p_image_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select auth.uid() is not null
    and exists (
      select 1
      from private.comment_image_uploaders as uploader
      where uploader.image_id = p_image_id
        and uploader.profile_id = private.current_profile_id()
    );
$$;

ALTER FUNCTION "private"."is_comment_image_uploader"("p_image_id" "uuid") OWNER TO "postgres";

-- 댓글의 멘션 토큰과 `public.comment_mentions`를 맞춘다. 게시물 쪽
-- `private.sync_post_mentions`와 같은 규칙이며, 그룹 판정만 부모 게시물에서 가져온다.
CREATE OR REPLACE FUNCTION "private"."sync_comment_mentions"("p_comment_id" "uuid", "p_body" "text", "p_author_identity" "public"."post_identity", "p_mention_pub_ids" "text"[]) RETURNS "void"
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
  from public.comment_mentions as mention
  where mention.comment_id = p_comment_id;

  delete from public.comment_mentions where comment_id = p_comment_id;
  if coalesce(array_length(ordinals, 1), 0) = 0 then
    return;
  end if;

  select post.* into post_record
  from public.posts as post
  join public.post_comments as comment on comment.post_id = post.id
  where comment.id = p_comment_id;
  -- 개인 게시물의 댓글에는 멘션을 두지 않는다(기능 명세 §8.14).
  if post_record.kind <> 'group' then
    raise exception 'mentions are only available in group posts' using errcode = '22023';
  end if;
  if p_author_identity = 'anonymous' then
    raise exception 'anonymous comments cannot mention members' using errcode = '42501';
  end if;
  if (select max(entry.ordinal) from unnest(ordinals) as entry(ordinal)) > 10 then
    raise exception 'a comment can mention at most 10 members' using errcode = '22023';
  end if;

  -- 이미 불린 사람은 멤버십을 다시 묻지 않는다. 다시 물으면 멘션된 멤버가 그룹을 나간 뒤로는
  -- 제목 오타 하나 고치려 해도 저장이 막히고, 작성자가 본문에서 그 토큰을 손으로 찾아 지우는
  -- 수밖에 없다. 이미 나간 시점의 알림은 이미 갔고 칩은 프로필로 남는다 -- 새로 부르는
  -- 사람에게만 멤버십을 요구하면 충분하다.
  insert into public.comment_mentions (comment_id, ordinal, profile_id)
  select p_comment_id, entry.ordinal, profile.id
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

  if resolved_count <> array_length(ordinals, 1) then
    raise exception 'every mention must name a current group member' using errcode = '22023';
  end if;
end;
$$;

ALTER FUNCTION "private"."sync_comment_mentions"("p_comment_id" "uuid", "p_body" "text", "p_author_identity" "public"."post_identity", "p_mention_pub_ids" "text"[]) OWNER TO "postgres";

-- 댓글 읽기 RPC가 본문 옆에 실어 보내는 표현용 멘션 목록. 탈퇴한 사용자는 다른 화면과 같은
-- 규칙으로 null이 되어 나가고 화면이 `탈퇴한 사용자`로 그린다.
CREATE OR REPLACE FUNCTION "private"."comment_mentions_json"("p_comment_id" "uuid") RETURNS "jsonb"
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
  from public.comment_mentions as mention
  left join public.profiles as profile on profile.id = mention.profile_id
    and profile.status = 'accepted' and profile.deleted_at is null
  where mention.comment_id = p_comment_id;
$$;

ALTER FUNCTION "private"."comment_mentions_json"("p_comment_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."prevent_comment_immutable_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.id is distinct from old.id
    or new.post_id is distinct from old.post_id
    or new.parent_comment_id is distinct from old.parent_comment_id
    or new.root_comment_id is distinct from old.root_comment_id
    or new.depth is distinct from old.depth
    or new.author_identity is distinct from old.author_identity
    or new.display_author_profile_id is distinct from old.display_author_profile_id
    or new.anon_alias_number is distinct from old.anon_alias_number
    or new.created_at is distinct from old.created_at then
    raise exception 'comment identity and thread position cannot be changed'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

ALTER FUNCTION "private"."prevent_comment_immutable_changes"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."sync_post_comment_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is null then
      update public.posts set comment_count = comment_count + 1 where id = new.post_id;
    end if;
  elsif tg_op = 'DELETE' then
    if old.deleted_at is null then
      update public.posts
      set comment_count = greatest(comment_count - 1, 0)
      where id = old.post_id;
    end if;
  elsif old.deleted_at is null and new.deleted_at is not null then
    update public.posts
    set comment_count = greatest(comment_count - 1, 0)
    where id = new.post_id;
  elsif old.deleted_at is not null and new.deleted_at is null then
    update public.posts set comment_count = comment_count + 1 where id = new.post_id;
  end if;
  return null;
end;
$$;

ALTER FUNCTION "private"."sync_post_comment_count"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."tombstone_comment_images"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.comment_images
  set status = 'deleted', deleted_at = now()
  where comment_id = new.id and status = 'ready';
  return null;
end;
$$;

ALTER FUNCTION "private"."tombstone_comment_images"() OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."comment_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "comment_id" "uuid",
    "storage_bucket" "text" DEFAULT 'post-attachments'::"text" NOT NULL,
    "object_path" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "size_bytes" bigint NOT NULL,
    "width" integer NOT NULL,
    "height" integer NOT NULL,
    "status" "public"."comment_image_status" DEFAULT 'pending'::"public"."comment_image_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finalized_at" timestamp with time zone,
    "ready_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "comment_images_bucket_check" CHECK (("storage_bucket" = 'post-attachments'::"text")),
    CONSTRAINT "comment_images_dimensions_check" CHECK ("width" BETWEEN 1 AND 3072 AND "height" BETWEEN 1 AND 3072 AND greatest("width", "height") <= 3072),
    CONSTRAINT "comment_images_mime_check" CHECK (("mime_type" = 'image/webp'::"text")),
    CONSTRAINT "comment_images_path_check" CHECK (("object_path" = ((('comments/'::"text" || ("post_id")::"text") || '/'::"text") || ("id")::"text"))),
    CONSTRAINT "comment_images_size_check" CHECK ((("size_bytes" >= 1) AND ("size_bytes" <= 8388608))),
    CONSTRAINT "comment_images_status_timestamps_check" CHECK (((("status" = 'pending'::"public"."comment_image_status") AND ("comment_id" IS NULL) AND ("finalized_at" IS NULL) AND ("ready_at" IS NULL) AND ("deleted_at" IS NULL)) OR (("status" = 'finalized'::"public"."comment_image_status") AND ("comment_id" IS NULL) AND ("finalized_at" IS NOT NULL) AND ("ready_at" IS NULL) AND ("deleted_at" IS NULL)) OR (("status" = 'ready'::"public"."comment_image_status") AND ("comment_id" IS NOT NULL) AND ("finalized_at" IS NOT NULL) AND ("ready_at" IS NOT NULL) AND ("deleted_at" IS NULL)) OR (("status" = 'deleted'::"public"."comment_image_status") AND ("deleted_at" IS NOT NULL))))
);

ALTER TABLE "public"."comment_images" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "private"."comment_authors" (
    "comment_id" "uuid" NOT NULL,
    "profile_id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "private"."comment_authors" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "private"."comment_image_uploaders" (
    "image_id" "uuid" NOT NULL,
    "profile_id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "private"."comment_image_uploaders" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "private"."post_anonymous_aliases" (
    "post_id" "uuid" NOT NULL,
    "profile_id" bigint NOT NULL,
    "alias_number" smallint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "post_anonymous_aliases_number_positive" CHECK (("alias_number" >= 1))
);

ALTER TABLE "private"."post_anonymous_aliases" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "private"."group_anonymous_activity_restrictions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "profile_id" bigint NOT NULL,
    "reason" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "restricted_by_profile_id" bigint,
    "source_kind" "text" NOT NULL,
    "source_post_id" "uuid",
    "source_comment_id" "uuid",
    "ended_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "cancelled_by_profile_id" bigint,
    CONSTRAINT "group_anonymous_restrictions_reason" CHECK (("reason" = "btrim"("reason")) AND ("char_length"("reason") >= 5) AND ("char_length"("reason") <= 300)),
    CONSTRAINT "group_anonymous_restrictions_duration" CHECK (("expires_at" > "created_at") AND ("expires_at" <= ("created_at" + '180 days'::interval))),
    CONSTRAINT "group_anonymous_restrictions_source_kind" CHECK (("source_kind" = ANY (ARRAY['post'::"text", 'comment'::"text"]))),
    CONSTRAINT "group_anonymous_restrictions_source_shape" CHECK ((("source_post_id" IS NULL) AND ("source_comment_id" IS NULL)) OR (("source_kind" = 'post'::"text") AND ("source_post_id" IS NOT NULL) AND ("source_comment_id" IS NULL)) OR (("source_kind" = 'comment'::"text") AND ("source_post_id" IS NULL) AND ("source_comment_id" IS NOT NULL))),
    CONSTRAINT "group_anonymous_restrictions_end_shape" CHECK ((("ended_at" IS NULL) AND ("cancelled_at" IS NULL) AND ("cancelled_by_profile_id" IS NULL)) OR (("ended_at" = "expires_at") AND ("cancelled_at" IS NULL) AND ("cancelled_by_profile_id" IS NULL)) OR (("ended_at" = "cancelled_at") AND ("cancelled_at" IS NOT NULL)))
);

ALTER TABLE "private"."group_anonymous_activity_restrictions" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."post_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "parent_comment_id" "uuid",
    "root_comment_id" "uuid" NOT NULL,
    "depth" smallint DEFAULT 0 NOT NULL,
    "body" "text" NOT NULL,
    "author_identity" "public"."post_identity" NOT NULL,
    "display_author_profile_id" bigint,
    "anon_alias_number" smallint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "edited_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "post_comments_anon_alias_shape" CHECK (((("author_identity" = 'anonymous'::"public"."post_identity") AND ("anon_alias_number" IS NOT NULL) AND ("anon_alias_number" >= 0)) OR (("author_identity" <> 'anonymous'::"public"."post_identity") AND ("anon_alias_number" IS NULL)))),
    CONSTRAINT "post_comments_body_length" CHECK ((("char_length"("btrim"("body")) >= 0) AND ("char_length"("btrim"("body")) <= 5000))),
    CONSTRAINT "post_comments_depth_range" CHECK ((("depth" >= 0) AND ("depth" <= 10))),
    CONSTRAINT "post_comments_display_author_shape" CHECK (((("author_identity" = 'identified'::"public"."post_identity") AND ("display_author_profile_id" IS NOT NULL)) OR (("author_identity" = ANY (ARRAY['anonymous'::"public"."post_identity", 'staff'::"public"."post_identity"])) AND ("display_author_profile_id" IS NULL)))),
    CONSTRAINT "post_comments_edit_timestamps" CHECK (((("edited_at" IS NULL) OR ("edited_at" >= "created_at")) AND (("deleted_at" IS NULL) OR ("deleted_at" >= "created_at")))),
    CONSTRAINT "post_comments_thread_shape" CHECK (((("depth" = 0) AND ("parent_comment_id" IS NULL) AND ("root_comment_id" = "id")) OR (("depth" > 0) AND ("parent_comment_id" IS NOT NULL) AND ("root_comment_id" <> "id"))))
);

ALTER TABLE "public"."post_comments" OWNER TO "postgres";

-- 댓글 멘션도 게시물과 같은 모양이다(기능 명세 §8.14). `public.post_mentions`의 주석에 왜
-- 본문에 pub_id를 두지 않는지 적어 두었다.
CREATE TABLE IF NOT EXISTS "public"."comment_mentions" (
    "comment_id" "uuid" NOT NULL,
    "ordinal" smallint NOT NULL,
    "profile_id" bigint NOT NULL,
    CONSTRAINT "comment_mentions_ordinal_range" CHECK ((("ordinal" >= 1) AND ("ordinal" <= 10)))
);

ALTER TABLE "public"."comment_mentions" OWNER TO "postgres";

ALTER TABLE ONLY "private"."comment_authors"
    ADD CONSTRAINT "comment_authors_pkey" PRIMARY KEY ("comment_id");

ALTER TABLE ONLY "private"."comment_image_uploaders"
    ADD CONSTRAINT "comment_image_uploaders_pkey" PRIMARY KEY ("image_id");

ALTER TABLE ONLY "private"."post_anonymous_aliases"
    ADD CONSTRAINT "post_anonymous_aliases_number_unique" UNIQUE ("post_id", "alias_number");

ALTER TABLE ONLY "private"."post_anonymous_aliases"
    ADD CONSTRAINT "post_anonymous_aliases_pkey" PRIMARY KEY ("post_id", "profile_id");

ALTER TABLE ONLY "private"."group_anonymous_activity_restrictions"
    ADD CONSTRAINT "group_anonymous_activity_restrictions_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."comment_images"
    ADD CONSTRAINT "comment_images_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."comment_images"
    ADD CONSTRAINT "comment_images_storage_bucket_object_path_key" UNIQUE ("storage_bucket", "object_path");

ALTER TABLE ONLY "public"."post_comments"
    ADD CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."comment_mentions"
    ADD CONSTRAINT "comment_mentions_pkey" PRIMARY KEY ("comment_id", "ordinal");

-- 한 사람은 한 댓글에서 ordinal 하나를 쓴다. 같은 사람이 ordinal 둘로 들어오면 화면의
-- 칩과 대상이 1:1이 아니게 되고, 클라이언트가 제출 전에 다시 매기는 번호와도 어긋난다.
CREATE UNIQUE INDEX "comment_mentions_target_idx" ON "public"."comment_mentions" USING "btree" ("comment_id", "profile_id");

CREATE INDEX "comment_authors_profile_idx" ON "private"."comment_authors" USING "btree" ("profile_id", "comment_id");

CREATE INDEX "comment_image_uploaders_profile_idx" ON "private"."comment_image_uploaders" USING "btree" ("profile_id", "image_id");

CREATE INDEX "comment_images_cleanup_idx" ON "public"."comment_images" USING "btree" ("created_at", "id") WHERE ("status" = ANY (ARRAY['pending'::"public"."comment_image_status", 'finalized'::"public"."comment_image_status", 'deleted'::"public"."comment_image_status"]));

CREATE INDEX "comment_images_post_idx" ON "public"."comment_images" USING "btree" ("post_id", "comment_id") WHERE ("status" = 'ready'::"public"."comment_image_status");

CREATE UNIQUE INDEX "comment_images_ready_comment_idx" ON "public"."comment_images" USING "btree" ("comment_id") WHERE ("status" = 'ready'::"public"."comment_image_status");

CREATE INDEX "post_comments_live_child_idx" ON "public"."post_comments" USING "btree" ("parent_comment_id") WHERE ("deleted_at" IS NULL);

CREATE INDEX "post_comments_thread_idx" ON "public"."post_comments" USING "btree" ("root_comment_id", "created_at", "id");

CREATE INDEX "post_comments_top_level_idx" ON "public"."post_comments" USING "btree" ("post_id", "created_at" DESC, "id" DESC) WHERE (("depth" = 0) AND ("deleted_at" IS NULL));

CREATE UNIQUE INDEX "group_anonymous_restrictions_active_idx" ON "private"."group_anonymous_activity_restrictions" USING "btree" ("group_id", "profile_id") WHERE ("ended_at" IS NULL);

CREATE INDEX "group_anonymous_restrictions_profile_idx" ON "private"."group_anonymous_activity_restrictions" USING "btree" ("profile_id", "group_id", "expires_at" DESC);

CREATE OR REPLACE TRIGGER "post_comments_prevent_immutable_changes" BEFORE UPDATE ON "public"."post_comments" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_comment_immutable_changes"();

CREATE OR REPLACE TRIGGER "post_comments_sync_count" AFTER INSERT OR DELETE OR UPDATE OF "deleted_at" ON "public"."post_comments" FOR EACH ROW EXECUTE FUNCTION "private"."sync_post_comment_count"();

CREATE OR REPLACE TRIGGER "post_comments_tombstone_images" AFTER UPDATE OF "deleted_at" ON "public"."post_comments" FOR EACH ROW WHEN ((("old"."deleted_at" IS NULL) AND ("new"."deleted_at" IS NOT NULL))) EXECUTE FUNCTION "private"."tombstone_comment_images"();

ALTER TABLE ONLY "private"."comment_authors"
    ADD CONSTRAINT "comment_authors_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."post_comments"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "private"."comment_authors"
    ADD CONSTRAINT "comment_authors_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");

ALTER TABLE ONLY "private"."comment_image_uploaders"
    ADD CONSTRAINT "comment_image_uploaders_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "public"."comment_images"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "private"."comment_image_uploaders"
    ADD CONSTRAINT "comment_image_uploaders_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");

ALTER TABLE ONLY "private"."post_anonymous_aliases"
    ADD CONSTRAINT "post_anonymous_aliases_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "private"."post_anonymous_aliases"
    ADD CONSTRAINT "post_anonymous_aliases_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");

ALTER TABLE ONLY "private"."group_anonymous_activity_restrictions"
    ADD CONSTRAINT "group_anonymous_restrictions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "private"."group_anonymous_activity_restrictions"
    ADD CONSTRAINT "group_anonymous_restrictions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "private"."group_anonymous_activity_restrictions"
    ADD CONSTRAINT "group_anonymous_restrictions_restricted_by_fkey" FOREIGN KEY ("restricted_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "private"."group_anonymous_activity_restrictions"
    ADD CONSTRAINT "group_anonymous_restrictions_cancelled_by_fkey" FOREIGN KEY ("cancelled_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "private"."group_anonymous_activity_restrictions"
    ADD CONSTRAINT "group_anonymous_restrictions_source_post_fkey" FOREIGN KEY ("source_post_id") REFERENCES "public"."posts"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "private"."group_anonymous_activity_restrictions"
    ADD CONSTRAINT "group_anonymous_restrictions_source_comment_fkey" FOREIGN KEY ("source_comment_id") REFERENCES "public"."post_comments"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."comment_images"
    ADD CONSTRAINT "comment_images_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."post_comments"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."comment_images"
    ADD CONSTRAINT "comment_images_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."post_comments"
    ADD CONSTRAINT "post_comments_display_author_profile_id_fkey" FOREIGN KEY ("display_author_profile_id") REFERENCES "public"."profiles"("id");

ALTER TABLE ONLY "public"."post_comments"
    ADD CONSTRAINT "post_comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."post_comments"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."post_comments"
    ADD CONSTRAINT "post_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."comment_mentions"
    ADD CONSTRAINT "comment_mentions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."post_comments"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."comment_mentions"
    ADD CONSTRAINT "comment_mentions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE "private"."comment_authors" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comment_authors_deny_client_access" ON "private"."comment_authors" USING (false) WITH CHECK (false);

ALTER TABLE "private"."comment_image_uploaders" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comment_image_uploaders_deny_client_access" ON "private"."comment_image_uploaders" USING (false) WITH CHECK (false);

ALTER TABLE "private"."post_anonymous_aliases" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_anonymous_aliases_deny_client_access" ON "private"."post_anonymous_aliases" USING (false) WITH CHECK (false);

ALTER TABLE "private"."group_anonymous_activity_restrictions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_anonymous_restrictions_deny_client_access" ON "private"."group_anonymous_activity_restrictions" USING (false) WITH CHECK (false);

ALTER TABLE "public"."comment_images" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comment_images_deny_client_access" ON "public"."comment_images" USING (false) WITH CHECK (false);

ALTER TABLE "public"."comment_mentions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comment_mentions_deny_client_access" ON "public"."comment_mentions" USING (false) WITH CHECK (false);

ALTER TABLE "public"."post_comments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_comments_deny_client_access" ON "public"."post_comments" USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION "private"."group_anonymous_activity_restricted"("p_group_id" "uuid", "p_profile_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from private.group_anonymous_activity_restrictions as restriction
    where restriction.group_id = p_group_id
      and restriction.profile_id = p_profile_id
      and restriction.ended_at is null
      and restriction.expires_at > now()
  );
$$;

ALTER FUNCTION "private"."group_anonymous_activity_restricted"("p_group_id" "uuid", "p_profile_id" bigint) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."lock_group_anonymous_activity_target"("p_group_id" "uuid", "p_profile_id" bigint) RETURNS "void"
    LANGUAGE "sql" VOLATILE
    SET "search_path" TO ''
    AS $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_group_id::text || ':' || p_profile_id::text, 0)
  );
$$;

ALTER FUNCTION "private"."lock_group_anonymous_activity_target"("p_group_id" "uuid", "p_profile_id" bigint) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."assert_group_anonymous_activity_allowed"("p_group_id" "uuid", "p_profile_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if private.group_anonymous_activity_restricted(p_group_id, p_profile_id) then
    raise exception 'anonymous activity is restricted'
      using errcode = '42501';
  end if;
end;
$$;

ALTER FUNCTION "private"."assert_group_anonymous_activity_allowed"("p_group_id" "uuid", "p_profile_id" bigint) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "private"."can_read_comment_image_object"("p_storage_bucket" "text", "p_object_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_read_comment_image_object"("p_storage_bucket" "text", "p_object_path" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "private"."can_upload_comment_image_object"("p_storage_bucket" "text", "p_object_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_upload_comment_image_object"("p_storage_bucket" "text", "p_object_path" "text") TO "authenticated";


REVOKE ALL ON FUNCTION "private"."comment_author_label"("p_identity" "public"."post_identity", "p_alias" smallint, "p_name" "text") FROM PUBLIC;


REVOKE ALL ON FUNCTION "private"."is_comment_image_uploader"("p_image_id" "uuid") FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."sync_comment_mentions"("p_comment_id" "uuid", "p_body" "text", "p_author_identity" "public"."post_identity", "p_mention_pub_ids" "text"[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."comment_mentions_json"("p_comment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_comment_image_uploader"("p_image_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "private"."prevent_comment_immutable_changes"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."sync_post_comment_count"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."tombstone_comment_images"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."group_anonymous_activity_restricted"("p_group_id" "uuid", "p_profile_id" bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."lock_group_anonymous_activity_target"("p_group_id" "uuid", "p_profile_id" bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."assert_group_anonymous_activity_allowed"("p_group_id" "uuid", "p_profile_id" bigint) FROM PUBLIC;

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."comment_images" TO "service_role";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."post_comments" TO "service_role";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."comment_mentions" TO "service_role";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."post_comments" FROM "anon", "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."comment_mentions" FROM "anon", "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."comment_images" FROM "anon", "authenticated";
