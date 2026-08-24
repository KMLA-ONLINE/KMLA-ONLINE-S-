-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.


CREATE TYPE "public"."post_reaction" AS ENUM (
    'like',
    'love',
    'haha',
    'wow',
    'sad',
    'angry'
);

ALTER TYPE "public"."post_reaction" OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."comment_reaction_summary"("p_comment_id" "uuid", "p_caller_profile_id" bigint) RETURNS TABLE("reaction_count" integer, "top_reactions" "public"."post_reaction"[], "my_reaction" "public"."post_reaction")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with tally as (
    select
      entry.reaction,
      count(*)::integer as n,
      row_number() over (order by count(*) desc, entry.reaction) as rank
    from public.comment_reactions as entry
    where entry.comment_id = p_comment_id
    group by entry.reaction
  )
  select
    coalesce((select sum(tally.n)::integer from tally), 0),
    coalesce(
      (
        select array_agg(ranked.reaction order by ranked.n desc, ranked.reaction)
        from tally as ranked
        where ranked.rank <= 3
      ),
      array[]::public.post_reaction[]
    ),
    (
      select mine.reaction
      from public.comment_reactions as mine
      where mine.comment_id = p_comment_id and mine.profile_id = p_caller_profile_id
    );
$$;

ALTER FUNCTION "private"."comment_reaction_summary"("p_comment_id" "uuid", "p_caller_profile_id" bigint) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."post_reaction_summary"("p_post_id" "uuid", "p_caller_profile_id" bigint) RETURNS TABLE("reaction_count" integer, "top_reactions" "public"."post_reaction"[], "my_reaction" "public"."post_reaction")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with tally as (
    select
      entry.reaction,
      count(*)::integer as n,
      row_number() over (order by count(*) desc, entry.reaction) as rank
    from public.post_reactions as entry
    where entry.post_id = p_post_id
    group by entry.reaction
  )
  select
    coalesce((select sum(tally.n)::integer from tally), 0),
    coalesce(
      (
        select array_agg(ranked.reaction order by ranked.n desc, ranked.reaction)
        from tally as ranked
        where ranked.rank <= 3
      ),
      array[]::public.post_reaction[]
    ),
    (
      select mine.reaction
      from public.post_reactions as mine
      where mine.post_id = p_post_id and mine.profile_id = p_caller_profile_id
    );
$$;

ALTER FUNCTION "private"."post_reaction_summary"("p_post_id" "uuid", "p_caller_profile_id" bigint) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."reaction_context"("p_post_id" "uuid", "p_caller_profile_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  post_record public.posts;
  group_record public.groups;
begin
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id
    and post.published_at is not null and post.deleted_at is null;
  if post_record.id is null then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  if post_record.kind = 'profile' then
    if not private.can_read_post(p_post_id) then
      raise exception 'post is not accessible' using errcode = '42501';
    end if;
    return;
  end if;
  select group_data.* into group_record
  from public.groups as group_data
  where group_data.id = post_record.group_id;
  if group_record.id is null then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.group_memberships as membership
    where membership.group_id = group_record.id
      and membership.profile_id = p_caller_profile_id
  ) then
    raise exception 'group membership required' using errcode = '42501';
  end if;
end;
$$;

ALTER FUNCTION "private"."reaction_context"("p_post_id" "uuid", "p_caller_profile_id" bigint) OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."comment_reactions" (
    "comment_id" "uuid" NOT NULL,
    "profile_id" bigint NOT NULL,
    "reaction" "public"."post_reaction" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."comment_reactions" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."post_reactions" (
    "post_id" "uuid" NOT NULL,
    "profile_id" bigint NOT NULL,
    "reaction" "public"."post_reaction" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."post_reactions" OWNER TO "postgres";

ALTER TABLE ONLY "public"."comment_reactions"
    ADD CONSTRAINT "comment_reactions_pkey" PRIMARY KEY ("comment_id", "profile_id");

ALTER TABLE ONLY "public"."post_reactions"
    ADD CONSTRAINT "post_reactions_pkey" PRIMARY KEY ("post_id", "profile_id");

CREATE INDEX "comment_reactions_summary_idx" ON "public"."comment_reactions" USING "btree" ("comment_id", "reaction");

CREATE INDEX "post_reactions_summary_idx" ON "public"."post_reactions" USING "btree" ("post_id", "reaction");

ALTER TABLE ONLY "public"."comment_reactions"
    ADD CONSTRAINT "comment_reactions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."post_comments"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."comment_reactions"
    ADD CONSTRAINT "comment_reactions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");

ALTER TABLE ONLY "public"."post_reactions"
    ADD CONSTRAINT "post_reactions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."post_reactions"
    ADD CONSTRAINT "post_reactions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");

ALTER TABLE "public"."comment_reactions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comment_reactions_deny_client_access" ON "public"."comment_reactions" USING (false) WITH CHECK (false);

ALTER TABLE "public"."post_reactions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_reactions_deny_client_access" ON "public"."post_reactions" USING (false) WITH CHECK (false);

REVOKE ALL ON FUNCTION "private"."comment_reaction_summary"("p_comment_id" "uuid", "p_caller_profile_id" bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."post_reaction_summary"("p_post_id" "uuid", "p_caller_profile_id" bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."reaction_context"("p_post_id" "uuid", "p_caller_profile_id" bigint) FROM PUBLIC;

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."comment_reactions" TO "service_role";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."post_reactions" TO "service_role";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."post_reactions" FROM "anon", "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."comment_reactions" FROM "anon", "authenticated";
