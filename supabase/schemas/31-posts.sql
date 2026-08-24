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
  if attachment_count > 10
    or attachment_count <> (
      select count(distinct attachment_id)
      from unnest(coalesce(p_attachment_ids, '{}'::uuid[])) as attachment_id
    ) then
    raise exception 'attachment order must contain at most 10 unique ids' using errcode = '22023';
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
  set status = 'deleted', deleted_at = now(), cleanup_lease_id = null,
    cleanup_lease_expires_at = null
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

CREATE OR REPLACE FUNCTION "private"."can_read_post"("p_post_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.current_profile_id() is not null
    and exists (
      select 1
      from public.posts as post
      where post.id = p_post_id
        and post.deleted_at is null
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

CREATE OR REPLACE FUNCTION "private"."claim_post_attachment_cleanup"("p_limit" integer DEFAULT 100, "p_lease_seconds" integer DEFAULT 300) RETURNS TABLE("attachment_id" "uuid", "storage_bucket" "text", "object_path" "text", "lease_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_limit not between 1 and 500 or p_lease_seconds not between 30 and 3600 then
    raise exception 'invalid cleanup lease parameters' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select item.id
    from public.post_attachments as item
    where (
        (item.status = 'pending' and item.created_at <= now() - interval '48 hours')
        or item.status = 'deleted'
      )
      and (
        item.cleanup_lease_expires_at is null
        or item.cleanup_lease_expires_at <= now()
      )
    order by item.created_at, item.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.post_attachments as item
    set cleanup_lease_id = gen_random_uuid(),
      cleanup_lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    from candidates
    where item.id = candidates.id
    returning item.id, item.storage_bucket, item.object_path, item.cleanup_lease_id
  )
  select claimed.id, claimed.storage_bucket, claimed.object_path, claimed.cleanup_lease_id
  from claimed;
end;
$$;

ALTER FUNCTION "private"."claim_post_attachment_cleanup"("p_limit" integer, "p_lease_seconds" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."complete_post_attachment_cleanup"("p_attachment_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if coalesce(p_object_deleted, false) then
    delete from public.post_attachments
    where id = p_attachment_id
      and cleanup_lease_id = p_lease_id
      and cleanup_lease_expires_at > now()
      and (
        status = 'deleted'
        or (status = 'pending' and created_at <= now() - interval '48 hours')
      );
  else
    update public.post_attachments
    set cleanup_lease_id = null, cleanup_lease_expires_at = null
    where id = p_attachment_id and cleanup_lease_id = p_lease_id;
  end if;
  return found;
end;
$$;

ALTER FUNCTION "private"."complete_post_attachment_cleanup"("p_attachment_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."invoke_post_attachment_cleanup"() RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  project_url text;
  cleanup_secret text;
  request_id bigint;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'project_url';

  select decrypted_secret into cleanup_secret
  from vault.decrypted_secrets
  where name = 'post_attachment_cleanup_secret';

  if project_url is null or cleanup_secret is null then
    return null;
  end if;

  select net.http_post(
    url := project_url || '/functions/v1/cleanup-post-attachments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-secret', cleanup_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into request_id;

  return request_id;
end;
$$;

ALTER FUNCTION "private"."invoke_post_attachment_cleanup"() OWNER TO "postgres";

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

CREATE OR REPLACE FUNCTION "private"."prevent_post_immutable_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.id is distinct from old.id
    or new.kind is distinct from old.kind
    or new.group_id is distinct from old.group_id
    or new.timeline_profile_id is distinct from old.timeline_profile_id
    or new.author_identity is distinct from old.author_identity
    or new.display_author_profile_id is distinct from old.display_author_profile_id
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

CREATE OR REPLACE FUNCTION "public"."claim_post_attachment_cleanup"("p_limit" integer DEFAULT 100, "p_lease_seconds" integer DEFAULT 300) RETURNS TABLE("attachment_id" "uuid", "storage_bucket" "text", "object_path" "text", "lease_id" "uuid")
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  select *
  from private.claim_post_attachment_cleanup(p_limit, p_lease_seconds);
$$;

ALTER FUNCTION "public"."claim_post_attachment_cleanup"("p_limit" integer, "p_lease_seconds" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."complete_post_attachment_cleanup"("p_attachment_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) RETURNS boolean
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  select private.complete_post_attachment_cleanup(
    p_attachment_id,
    p_lease_id,
    p_object_deleted
  );
$$;

ALTER FUNCTION "public"."complete_post_attachment_cleanup"("p_attachment_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) OWNER TO "postgres";

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
    "cleanup_lease_id" "uuid",
    "cleanup_lease_expires_at" timestamp with time zone,
    CONSTRAINT "post_attachments_bucket_check" CHECK (("storage_bucket" = 'post-attachments'::"text")),
    CONSTRAINT "post_attachments_cleanup_lease_check" CHECK ((("cleanup_lease_id" IS NULL) = ("cleanup_lease_expires_at" IS NULL))),
    CONSTRAINT "post_attachments_dimensions_check" CHECK (("width" IS NULL AND "height" IS NULL) OR ("width" BETWEEN 1 AND 100000 AND "height" BETWEEN 1 AND 100000)),
    CONSTRAINT "post_attachments_filename_check" CHECK ((("char_length"("btrim"("original_filename")) >= 1) AND ("char_length"("btrim"("original_filename")) <= 255))),
    CONSTRAINT "post_attachments_mime_check" CHECK ((("char_length"("btrim"("mime_type")) >= 1) AND ("char_length"("btrim"("mime_type")) <= 255))),
    CONSTRAINT "post_attachments_path_check" CHECK (("object_path" = ((("post_id")::"text" || '/'::"text") || ("id")::"text"))),
    CONSTRAINT "post_attachments_position_check" CHECK ((("position" >= '-10'::integer) AND ("position" <= 9))),
    CONSTRAINT "post_attachments_size_check" CHECK ((("size_bytes" >= 1) AND ("size_bytes" <= 31457280))),
    CONSTRAINT "post_attachments_status_timestamps_check" CHECK (((("status" = 'pending'::"public"."post_attachment_status") AND ("ready_at" IS NULL) AND ("deleted_at" IS NULL)) OR (("status" = 'ready'::"public"."post_attachment_status") AND ("ready_at" IS NOT NULL) AND ("deleted_at" IS NULL)) OR (("status" = 'deleted'::"public"."post_attachment_status") AND ("deleted_at" IS NOT NULL))))
);

ALTER TABLE "public"."post_attachments" OWNER TO "postgres";

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
    "deleted_at" timestamp with time zone,
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
    CONSTRAINT "posts_publication_timestamps" CHECK (((("published_at" IS NULL) OR ("published_at" >= "created_at")) AND (("edited_at" IS NULL) OR (("published_at" IS NOT NULL) AND ("edited_at" >= "published_at"))) AND (("deleted_at" IS NULL) OR ("published_at" IS NULL) OR ("deleted_at" >= "published_at")) AND (("pinned_at" IS NULL) OR (("published_at" IS NOT NULL) AND ("pinned_at" >= "published_at"))))),
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

ALTER TABLE ONLY "public"."post_attachments"
    ADD CONSTRAINT "post_attachments_storage_bucket_object_path_key" UNIQUE ("storage_bucket", "object_path");

ALTER TABLE ONLY "public"."posts"
    ADD CONSTRAINT "posts_pkey" PRIMARY KEY ("id");

CREATE INDEX "post_authors_profile_idx" ON "private"."post_authors" USING "btree" ("profile_id", "post_id");

CREATE UNIQUE INDEX "group_categories_name_unique_idx" ON "public"."group_categories" USING "btree" ("group_id", "lower"("btrim"("name")));

CREATE INDEX "group_categories_order_idx" ON "public"."group_categories" USING "btree" ("group_id", "position", "id");

CREATE UNIQUE INDEX "post_attachments_active_position_idx" ON "public"."post_attachments" USING "btree" ("post_id", "position") WHERE ("status" <> 'deleted'::"public"."post_attachment_status");

CREATE INDEX "post_attachments_cleanup_idx" ON "public"."post_attachments" USING "btree" ("created_at", "id") WHERE ("status" = ANY (ARRAY['pending'::"public"."post_attachment_status", 'deleted'::"public"."post_attachment_status"]));

CREATE INDEX "post_attachments_post_list_idx" ON "public"."post_attachments" USING "btree" ("post_id", "position", "id") WHERE ("status" = 'ready'::"public"."post_attachment_status");

CREATE INDEX "posts_category_recent_idx" ON "public"."posts" USING "btree" ("group_id", "category_id", "published_at" DESC, "id" DESC) WHERE (("kind" = 'group'::"public"."post_kind") AND ("category_id" IS NOT NULL) AND ("published_at" IS NOT NULL) AND ("deleted_at" IS NULL));

CREATE INDEX "posts_display_author_idx" ON "public"."posts" USING "btree" ("display_author_profile_id", "published_at" DESC, "id" DESC) WHERE ("display_author_profile_id" IS NOT NULL);

CREATE INDEX "posts_group_pinned_idx" ON "public"."posts" USING "btree" ("group_id", "published_at" DESC, "id" DESC) WHERE (("kind" = 'group'::"public"."post_kind") AND ("pinned_at" IS NOT NULL) AND ("deleted_at" IS NULL));

CREATE INDEX "posts_group_recent_idx" ON "public"."posts" USING "btree" ("group_id", "published_at" DESC, "id" DESC) WHERE (("kind" = 'group'::"public"."post_kind") AND ("published_at" IS NOT NULL) AND ("deleted_at" IS NULL));

CREATE INDEX "posts_group_search_idx" ON "public"."posts" USING "gin" ("search_text" "extensions"."gin_trgm_ops") WHERE (("kind" = 'group'::"public"."post_kind") AND ("published_at" IS NOT NULL) AND ("deleted_at" IS NULL));

CREATE UNIQUE INDEX "posts_profile_activity_media_path_key" ON "public"."posts" USING "btree" ("activity_media_path") WHERE ("activity_media_path" IS NOT NULL);

CREATE INDEX "posts_public_profile_feed_idx" ON "public"."posts" USING "btree" ("published_at" DESC, "id" DESC) WHERE (("kind" = 'profile'::"public"."post_kind") AND ("visibility" = 'public'::"public"."post_visibility") AND ("published_at" IS NOT NULL) AND ("deleted_at" IS NULL));

CREATE INDEX "posts_timeline_idx" ON "public"."posts" USING "btree" ("timeline_profile_id", "published_at" DESC, "id" DESC) WHERE (("kind" = 'profile'::"public"."post_kind") AND ("published_at" IS NOT NULL) AND ("deleted_at" IS NULL));

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

CREATE POLICY "post_attachments_select_reader" ON "public"."post_attachments" FOR SELECT TO "authenticated" USING ((("status" <> 'deleted'::"public"."post_attachment_status") AND (("status" = 'ready'::"public"."post_attachment_status") OR "private"."is_post_author"("post_id")) AND "private"."can_read_post"("post_id")));

ALTER TABLE "public"."posts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "posts_select_readable" ON "public"."posts" FOR SELECT TO "authenticated" USING ("private"."can_read_post"("id"));

REVOKE ALL ON FUNCTION "private"."apply_post_commit"("p_post_id" "uuid", "p_body" "text", "p_attachment_ids" "uuid"[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."can_read_post"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_read_post"("p_post_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "private"."claim_post_attachment_cleanup"("p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."claim_post_attachment_cleanup"("p_limit" integer, "p_lease_seconds" integer) TO "service_role";

REVOKE ALL ON FUNCTION "private"."complete_post_attachment_cleanup"("p_attachment_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."complete_post_attachment_cleanup"("p_attachment_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) TO "service_role";

REVOKE ALL ON FUNCTION "private"."invoke_post_attachment_cleanup"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."is_post_author"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_post_author"("p_post_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "private"."prevent_post_immutable_changes"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."prevent_profile_activity_attachments"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."validate_profile_activity_path"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."claim_post_attachment_cleanup"("p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_post_attachment_cleanup"("p_limit" integer, "p_lease_seconds" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."complete_post_attachment_cleanup"("p_attachment_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_post_attachment_cleanup"("p_attachment_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) TO "service_role";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."group_categories" TO "service_role";
GRANT SELECT ON TABLE "public"."group_categories" TO "authenticated";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."post_attachments" TO "service_role";
GRANT SELECT ON TABLE "public"."post_attachments" TO "authenticated";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."posts" TO "service_role";
GRANT SELECT ON TABLE "public"."posts" TO "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."group_categories" FROM "anon", "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."posts" FROM "anon", "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."post_attachments" FROM "anon", "authenticated";
