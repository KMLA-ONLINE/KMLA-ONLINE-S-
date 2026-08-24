-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.


CREATE TYPE "public"."group_post_report_reason" AS ENUM (
    'abuse',
    'sexual',
    'privacy',
    'impersonation',
    'spam',
    'other'
);

ALTER TYPE "public"."group_post_report_reason" OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."cleanup_group_post_reports"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from private.group_post_reports
  where post_id = new.id;

  delete from private.group_post_report_dismissals
  where post_id = new.id;

  return new;
end;
$$;

ALTER FUNCTION "private"."cleanup_group_post_reports"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."dismiss_group_post_reports"("p_post_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_profile_id bigint;
  caller_role public.group_member_role;
  post_group_id uuid;
begin
  caller_profile_id := private.current_profile_id();

  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  select post.group_id
  into post_group_id
  from public.posts as post
  where post.id = p_post_id
    and post.kind = 'group'
    and post.published_at is not null
    and post.deleted_at is null;

  if post_group_id is null then
    raise exception 'post not found'
      using errcode = 'P0002';
  end if;

  select membership.role
  into caller_role
  from public.group_memberships as membership
  where membership.group_id = post_group_id
    and membership.profile_id = caller_profile_id;

  -- 매니저는 신고를 조회만 한다(기능 명세 §8.15). 무시는 삭제와 같은 권한 경계에 둔다.
  if caller_role is null
    or caller_role not in ('owner', 'admin')
  then
    raise exception 'report dismissal is not allowed'
      using errcode = '42501';
  end if;

  insert into private.group_post_report_dismissals (
    post_id,
    dismissed_by_profile_id,
    dismissed_at
  )
  values (
    p_post_id,
    caller_profile_id,
    now()
  )
  on conflict (post_id) do update
  set
    dismissed_by_profile_id = excluded.dismissed_by_profile_id,
    dismissed_at = excluded.dismissed_at;
end;
$$;

ALTER FUNCTION "public"."dismiss_group_post_reports"("p_post_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_group_post_report_descriptions"("p_group_id" "uuid", "p_post_id" "uuid", "p_before_created_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_before_report_id" bigint DEFAULT NULL::bigint, "p_limit" integer DEFAULT 8) RETURNS TABLE("report_id" bigint, "reason" "public"."group_post_report_reason", "description" "text", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_profile_id bigint;
  caller_role public.group_member_role;
begin
  caller_profile_id := private.current_profile_id();

  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  select membership.role
  into caller_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = caller_profile_id;

  if caller_role is null
    or caller_role not in ('owner', 'admin', 'manager')
  then
    raise exception 'report review is not allowed'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.posts as post
    where post.id = p_post_id
      and post.group_id = p_group_id
      and post.kind = 'group'
      and post.deleted_at is null
  ) then
    raise exception 'post not found'
      using errcode = 'P0002';
  end if;

  return query
  select
    report.id,
    report.reason,
    report.description,
    report.created_at
  from private.group_post_reports as report
  left join private.group_post_report_dismissals as dismissal
    on dismissal.post_id = report.post_id
  where report.post_id = p_post_id
    and report.description is not null
    and (
      dismissal.dismissed_at is null
      or report.created_at > dismissal.dismissed_at
    )
    and (
      p_before_created_at is null
      or (
        p_before_report_id is not null
        and (
          report.created_at,
          report.id
        ) < (
          p_before_created_at,
          p_before_report_id
        )
      )
    )
  order by
    report.created_at desc,
    report.id desc
  limit least(
    greatest(coalesce(p_limit, 8), 1),
    30
  );
end;
$$;

ALTER FUNCTION "public"."list_group_post_report_descriptions"("p_group_id" "uuid", "p_post_id" "uuid", "p_before_created_at" timestamp with time zone, "p_before_report_id" bigint, "p_limit" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_group_post_report_summaries"("p_group_id" "uuid", "p_sort" "text" DEFAULT 'count'::"text", "p_cursor_report_count" bigint DEFAULT NULL::bigint, "p_cursor_latest_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_cursor_post_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 20) RETURNS TABLE("post_id" "uuid", "title" "text", "body_preview" "text", "author_identity" "public"."post_identity", "author_pub_id" "text", "author_name" "text", "author_avatar_path" "text", "author_label" "text", "report_count" bigint, "dismissed_count" bigint, "description_count" bigint, "abuse_count" bigint, "sexual_count" bigint, "privacy_count" bigint, "impersonation_count" bigint, "spam_count" bigint, "other_count" bigint, "latest_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_profile_id bigint;
  caller_role public.group_member_role;
begin
  caller_profile_id := private.current_profile_id();

  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  select membership.role
  into caller_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = caller_profile_id;

  if caller_role is null
    or caller_role not in ('owner', 'admin', 'manager')
  then
    raise exception 'report review is not allowed'
      using errcode = '42501';
  end if;

  if p_sort not in ('count', 'recent') then
    raise exception 'invalid report sort'
      using errcode = '22023';
  end if;

  return query
  with scoped as (
    select
      report.post_id,
      report.reason,
      report.description,
      report.created_at,
      dismissal.dismissed_at is not null
        and report.created_at <= dismissal.dismissed_at as dismissed
    from private.group_post_reports as report
    join public.posts as post
      on post.id = report.post_id
    left join private.group_post_report_dismissals as dismissal
      on dismissal.post_id = report.post_id
    where post.group_id = p_group_id
      and post.kind = 'group'
      and post.published_at is not null
      and post.deleted_at is null
  ),
  aggregated as (
    select
      scoped.post_id,
      count(*) filter (
        where not scoped.dismissed
      )::bigint as report_count,
      count(*) filter (
        where scoped.dismissed
      )::bigint as dismissed_count,
      count(scoped.description) filter (
        where not scoped.dismissed
      )::bigint as description_count,
      count(*) filter (
        where not scoped.dismissed
          and scoped.reason = 'abuse'
      )::bigint as abuse_count,
      count(*) filter (
        where not scoped.dismissed
          and scoped.reason = 'sexual'
      )::bigint as sexual_count,
      count(*) filter (
        where not scoped.dismissed
          and scoped.reason = 'privacy'
      )::bigint as privacy_count,
      count(*) filter (
        where not scoped.dismissed
          and scoped.reason = 'impersonation'
      )::bigint as impersonation_count,
      count(*) filter (
        where not scoped.dismissed
          and scoped.reason = 'spam'
      )::bigint as spam_count,
      count(*) filter (
        where not scoped.dismissed
          and scoped.reason = 'other'
      )::bigint as other_count,
      max(scoped.created_at) filter (
        where not scoped.dismissed
      ) as latest_at
    from scoped
    group by scoped.post_id
    -- 무시 이후 새 신고가 없으면 목록에서 내려간다.
    having count(*) filter (
      where not scoped.dismissed
    ) > 0
  ),
  shaped as (
    select
      post.id as post_id,
      post.title,
      case
        when char_length(post.body) > 360
          then left(post.body, 360) || '…'
        else post.body
      end as body_preview,
      post.author_identity,

      case
        when post.author_identity = 'anonymous'
          then null
        else author_profile.pub_id
      end as author_pub_id,

      case
        when post.author_identity = 'anonymous'
          then null
        else author_profile.name
      end as author_name,

      case
        when post.author_identity = 'anonymous'
          then null
        else author_profile.avatar_path
      end as author_avatar_path,

      case
        when post.author_identity = 'anonymous'
          then '익명'
        when post.author_identity = 'staff'
          then '운영진'
        else coalesce(author_profile.name, '알 수 없음')
      end as author_label,

      aggregated.report_count,
      aggregated.dismissed_count,
      aggregated.description_count,
      aggregated.abuse_count,
      aggregated.sexual_count,
      aggregated.privacy_count,
      aggregated.impersonation_count,
      aggregated.spam_count,
      aggregated.other_count,
      aggregated.latest_at

    from aggregated
    join public.posts as post
      on post.id = aggregated.post_id
    left join private.post_authors as actual_author
      on actual_author.post_id = post.id

    left join public.profiles as author_profile
      on author_profile.id = case
        when post.author_identity = 'identified'
          then post.display_author_profile_id
        when post.author_identity = 'staff'
          then actual_author.profile_id
        else null
      end
  )

  select
    shaped.post_id,
    shaped.title,
    shaped.body_preview,
    shaped.author_identity,
    shaped.author_pub_id,
    shaped.author_name,
    shaped.author_avatar_path,
    shaped.author_label,
    shaped.report_count,
    shaped.dismissed_count,
    shaped.description_count,
    shaped.abuse_count,
    shaped.sexual_count,
    shaped.privacy_count,
    shaped.impersonation_count,
    shaped.spam_count,
    shaped.other_count,
    shaped.latest_at
  from shaped
  where
    p_cursor_post_id is null
    or (
      p_sort = 'count'
      and (
        shaped.report_count,
        shaped.latest_at,
        shaped.post_id
      ) < (
        p_cursor_report_count,
        p_cursor_latest_at,
        p_cursor_post_id
      )
    )
    or (
      p_sort = 'recent'
      and (
        shaped.latest_at,
        shaped.post_id
      ) < (
        p_cursor_latest_at,
        p_cursor_post_id
      )
    )
  order by
    case
      when p_sort = 'count'
        then shaped.report_count
    end desc,
    shaped.latest_at desc,
    shaped.post_id desc
  limit least(
    greatest(coalesce(p_limit, 20), 1),
    50
  );
end;
$$;

ALTER FUNCTION "public"."list_group_post_report_summaries"("p_group_id" "uuid", "p_sort" "text", "p_cursor_report_count" bigint, "p_cursor_latest_at" timestamp with time zone, "p_cursor_post_id" "uuid", "p_limit" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."report_group_post"("p_post_id" "uuid", "p_reason" "public"."group_post_report_reason", "p_description" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_profile_id bigint;
  post_record public.posts%rowtype;
  normalized_description text;
begin
  caller_profile_id := private.current_profile_id();

  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  select post.*
  into post_record
  from public.posts as post
  where post.id = p_post_id
    and post.kind = 'group'
    and post.published_at is not null
    and post.deleted_at is null;

  if post_record.id is null then
    raise exception 'post not found'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = post_record.group_id
      and membership.profile_id = caller_profile_id
  ) then
    raise exception 'group membership required'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from private.post_authors as author
    where author.post_id = p_post_id
      and author.profile_id = caller_profile_id
  ) then
    raise exception 'cannot report own post'
      using errcode = '42501';
  end if;

  normalized_description :=
    nullif(btrim(coalesce(p_description, '')), '');

  if normalized_description is not null
    and char_length(normalized_description) not between 5 and 300
  then
    raise exception 'description must be between 5 and 300 characters'
      using errcode = '22023';
  end if;

  if p_reason = 'other'
    and normalized_description is null
  then
    raise exception 'description is required for other reason'
      using errcode = '22023';
  end if;

  insert into private.group_post_reports (
    post_id,
    reporter_profile_id,
    reason,
    description
  )
  values (
    p_post_id,
    caller_profile_id,
    p_reason,
    normalized_description
  );

exception
  when unique_violation then
    raise exception 'post already reported'
      using errcode = '23505';
end;
$$;

ALTER FUNCTION "public"."report_group_post"("p_post_id" "uuid", "p_reason" "public"."group_post_report_reason", "p_description" "text") OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "private"."group_post_report_dismissals" (
    "post_id" "uuid" NOT NULL,
    "dismissed_by_profile_id" bigint,
    "dismissed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "private"."group_post_report_dismissals" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "private"."group_post_reports" (
    "id" bigint NOT NULL,
    "post_id" "uuid" NOT NULL,
    "reporter_profile_id" bigint NOT NULL,
    "reason" "public"."group_post_report_reason" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "group_post_reports_description_length" CHECK ((("description" IS NULL) OR (("char_length"("description") >= 5) AND ("char_length"("description") <= 300)))),
    CONSTRAINT "group_post_reports_other_description" CHECK ((("reason" <> 'other'::"public"."group_post_report_reason") OR ("description" IS NOT NULL)))
);

ALTER TABLE "private"."group_post_reports" OWNER TO "postgres";

ALTER TABLE "private"."group_post_reports" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "private"."group_post_reports_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY "private"."group_post_report_dismissals"
    ADD CONSTRAINT "group_post_report_dismissals_pkey" PRIMARY KEY ("post_id");

ALTER TABLE ONLY "private"."group_post_reports"
    ADD CONSTRAINT "group_post_reports_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "private"."group_post_reports"
    ADD CONSTRAINT "group_post_reports_unique_reporter" UNIQUE ("post_id", "reporter_profile_id");

CREATE INDEX "group_post_reports_post_order_idx" ON "private"."group_post_reports" USING "btree" ("post_id", "created_at" DESC, "id" DESC);

CREATE OR REPLACE TRIGGER "posts_cleanup_group_reports" AFTER UPDATE OF "deleted_at" ON "public"."posts" FOR EACH ROW WHEN ((("old"."deleted_at" IS NULL) AND ("new"."deleted_at" IS NOT NULL))) EXECUTE FUNCTION "private"."cleanup_group_post_reports"();

ALTER TABLE ONLY "private"."group_post_report_dismissals"
    ADD CONSTRAINT "group_post_report_dismissals_dismissed_by_profile_id_fkey" FOREIGN KEY ("dismissed_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "private"."group_post_report_dismissals"
    ADD CONSTRAINT "group_post_report_dismissals_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "private"."group_post_reports"
    ADD CONSTRAINT "group_post_reports_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "private"."group_post_reports"
    ADD CONSTRAINT "group_post_reports_reporter_profile_id_fkey" FOREIGN KEY ("reporter_profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

REVOKE ALL ON FUNCTION "public"."dismiss_group_post_reports"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dismiss_group_post_reports"("p_post_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_group_post_report_descriptions"("p_group_id" "uuid", "p_post_id" "uuid", "p_before_created_at" timestamp with time zone, "p_before_report_id" bigint, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_group_post_report_descriptions"("p_group_id" "uuid", "p_post_id" "uuid", "p_before_created_at" timestamp with time zone, "p_before_report_id" bigint, "p_limit" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_group_post_report_summaries"("p_group_id" "uuid", "p_sort" "text", "p_cursor_report_count" bigint, "p_cursor_latest_at" timestamp with time zone, "p_cursor_post_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_group_post_report_summaries"("p_group_id" "uuid", "p_sort" "text", "p_cursor_report_count" bigint, "p_cursor_latest_at" timestamp with time zone, "p_cursor_post_id" "uuid", "p_limit" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."report_group_post"("p_post_id" "uuid", "p_reason" "public"."group_post_report_reason", "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_group_post"("p_post_id" "uuid", "p_reason" "public"."group_post_report_reason", "p_description" "text") TO "authenticated";
