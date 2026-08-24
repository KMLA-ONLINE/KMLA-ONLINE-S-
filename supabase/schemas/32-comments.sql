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

CREATE OR REPLACE FUNCTION "private"."claim_comment_image_cleanup"("p_limit" integer DEFAULT 100, "p_lease_seconds" integer DEFAULT 300) RETURNS TABLE("image_id" "uuid", "storage_bucket" "text", "object_path" "text", "lease_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_limit not between 1 and 500 or p_lease_seconds not between 30 and 3600 then
    raise exception 'invalid cleanup lease parameters' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select image.id
    from public.comment_images as image
    where (
        (image.status in ('pending', 'finalized')
          and image.created_at <= now() - interval '48 hours')
        or image.status = 'deleted'
      )
      and (
        image.cleanup_lease_expires_at is null
        or image.cleanup_lease_expires_at <= now()
      )
    order by image.created_at, image.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.comment_images as image
    set cleanup_lease_id = gen_random_uuid(),
      cleanup_lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    from candidates
    where image.id = candidates.id
    returning image.id, image.storage_bucket, image.object_path, image.cleanup_lease_id
  )
  select claimed.id, claimed.storage_bucket, claimed.object_path, claimed.cleanup_lease_id
  from claimed;
end;
$$;

ALTER FUNCTION "private"."claim_comment_image_cleanup"("p_limit" integer, "p_lease_seconds" integer) OWNER TO "postgres";

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

CREATE OR REPLACE FUNCTION "private"."complete_comment_image_cleanup"("p_image_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if coalesce(p_object_deleted, false) then
    delete from public.comment_images
    where id = p_image_id
      and cleanup_lease_id = p_lease_id
      and cleanup_lease_expires_at > now()
      and (
        status = 'deleted'
        or (status in ('pending', 'finalized')
          and created_at <= now() - interval '48 hours')
      );
  else
    update public.comment_images
    set cleanup_lease_id = null, cleanup_lease_expires_at = null
    where id = p_image_id and cleanup_lease_id = p_lease_id;
  end if;
  return found;
end;
$$;

ALTER FUNCTION "private"."complete_comment_image_cleanup"("p_image_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) OWNER TO "postgres";

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
  set status = 'deleted', deleted_at = now(), cleanup_lease_id = null,
    cleanup_lease_expires_at = null
  where comment_id = new.id and status = 'ready';
  return null;
end;
$$;

ALTER FUNCTION "private"."tombstone_comment_images"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."tombstone_post_comment_images"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.comment_images
  set status = 'deleted', deleted_at = now(), cleanup_lease_id = null,
    cleanup_lease_expires_at = null
  where post_id = new.id and status <> 'deleted';
  return null;
end;
$$;

ALTER FUNCTION "private"."tombstone_post_comment_images"() OWNER TO "postgres";

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
    "cleanup_lease_id" "uuid",
    "cleanup_lease_expires_at" timestamp with time zone,
    CONSTRAINT "comment_images_bucket_check" CHECK (("storage_bucket" = 'post-attachments'::"text")),
    CONSTRAINT "comment_images_cleanup_lease_check" CHECK ((("cleanup_lease_id" IS NULL) = ("cleanup_lease_expires_at" IS NULL))),
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

ALTER TABLE ONLY "private"."comment_authors"
    ADD CONSTRAINT "comment_authors_pkey" PRIMARY KEY ("comment_id");

ALTER TABLE ONLY "private"."comment_image_uploaders"
    ADD CONSTRAINT "comment_image_uploaders_pkey" PRIMARY KEY ("image_id");

ALTER TABLE ONLY "private"."post_anonymous_aliases"
    ADD CONSTRAINT "post_anonymous_aliases_number_unique" UNIQUE ("post_id", "alias_number");

ALTER TABLE ONLY "private"."post_anonymous_aliases"
    ADD CONSTRAINT "post_anonymous_aliases_pkey" PRIMARY KEY ("post_id", "profile_id");

ALTER TABLE ONLY "public"."comment_images"
    ADD CONSTRAINT "comment_images_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."comment_images"
    ADD CONSTRAINT "comment_images_storage_bucket_object_path_key" UNIQUE ("storage_bucket", "object_path");

ALTER TABLE ONLY "public"."post_comments"
    ADD CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id");

CREATE INDEX "comment_authors_profile_idx" ON "private"."comment_authors" USING "btree" ("profile_id", "comment_id");

CREATE INDEX "comment_image_uploaders_profile_idx" ON "private"."comment_image_uploaders" USING "btree" ("profile_id", "image_id");

CREATE INDEX "comment_images_cleanup_idx" ON "public"."comment_images" USING "btree" ("created_at", "id") WHERE ("status" = ANY (ARRAY['pending'::"public"."comment_image_status", 'finalized'::"public"."comment_image_status", 'deleted'::"public"."comment_image_status"]));

CREATE INDEX "comment_images_post_idx" ON "public"."comment_images" USING "btree" ("post_id", "comment_id") WHERE ("status" = 'ready'::"public"."comment_image_status");

CREATE UNIQUE INDEX "comment_images_ready_comment_idx" ON "public"."comment_images" USING "btree" ("comment_id") WHERE ("status" = 'ready'::"public"."comment_image_status");

CREATE INDEX "post_comments_live_child_idx" ON "public"."post_comments" USING "btree" ("parent_comment_id") WHERE ("deleted_at" IS NULL);

CREATE INDEX "post_comments_thread_idx" ON "public"."post_comments" USING "btree" ("root_comment_id", "created_at", "id");

CREATE INDEX "post_comments_top_level_idx" ON "public"."post_comments" USING "btree" ("post_id", "created_at" DESC, "id" DESC) WHERE (("depth" = 0) AND ("deleted_at" IS NULL));

CREATE OR REPLACE TRIGGER "post_comments_prevent_immutable_changes" BEFORE UPDATE ON "public"."post_comments" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_comment_immutable_changes"();

CREATE OR REPLACE TRIGGER "post_comments_sync_count" AFTER INSERT OR DELETE OR UPDATE OF "deleted_at" ON "public"."post_comments" FOR EACH ROW EXECUTE FUNCTION "private"."sync_post_comment_count"();

CREATE OR REPLACE TRIGGER "post_comments_tombstone_images" AFTER UPDATE OF "deleted_at" ON "public"."post_comments" FOR EACH ROW WHEN ((("old"."deleted_at" IS NULL) AND ("new"."deleted_at" IS NOT NULL))) EXECUTE FUNCTION "private"."tombstone_comment_images"();

CREATE OR REPLACE TRIGGER "posts_tombstone_comment_images" AFTER UPDATE OF "deleted_at" ON "public"."posts" FOR EACH ROW WHEN ((("old"."deleted_at" IS NULL) AND ("new"."deleted_at" IS NOT NULL))) EXECUTE FUNCTION "private"."tombstone_post_comment_images"();

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

ALTER TABLE "private"."comment_authors" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comment_authors_deny_client_access" ON "private"."comment_authors" USING (false) WITH CHECK (false);

ALTER TABLE "private"."comment_image_uploaders" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comment_image_uploaders_deny_client_access" ON "private"."comment_image_uploaders" USING (false) WITH CHECK (false);

ALTER TABLE "private"."post_anonymous_aliases" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_anonymous_aliases_deny_client_access" ON "private"."post_anonymous_aliases" USING (false) WITH CHECK (false);

ALTER TABLE "public"."comment_images" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comment_images_deny_client_access" ON "public"."comment_images" USING (false) WITH CHECK (false);

ALTER TABLE "public"."post_comments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_comments_deny_client_access" ON "public"."post_comments" USING (false) WITH CHECK (false);

REVOKE ALL ON FUNCTION "private"."can_read_comment_image_object"("p_storage_bucket" "text", "p_object_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_read_comment_image_object"("p_storage_bucket" "text", "p_object_path" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "private"."can_upload_comment_image_object"("p_storage_bucket" "text", "p_object_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_upload_comment_image_object"("p_storage_bucket" "text", "p_object_path" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "private"."claim_comment_image_cleanup"("p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."claim_comment_image_cleanup"("p_limit" integer, "p_lease_seconds" integer) TO "service_role";

REVOKE ALL ON FUNCTION "private"."comment_author_label"("p_identity" "public"."post_identity", "p_alias" smallint, "p_name" "text") FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."complete_comment_image_cleanup"("p_image_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."complete_comment_image_cleanup"("p_image_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) TO "service_role";

REVOKE ALL ON FUNCTION "private"."is_comment_image_uploader"("p_image_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_comment_image_uploader"("p_image_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "private"."prevent_comment_immutable_changes"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."sync_post_comment_count"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."tombstone_comment_images"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."tombstone_post_comment_images"() FROM PUBLIC;

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."comment_images" TO "service_role";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."post_comments" TO "service_role";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."post_comments" FROM "anon", "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."comment_images" FROM "anon", "authenticated";
