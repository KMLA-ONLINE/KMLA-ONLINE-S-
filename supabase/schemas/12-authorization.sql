-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.


-- 이용 정지(§16.11). 계정 상태는 `accepted`로 두고 이 이력으로 앱 이용을 막는다. 상태를 바꾸면
-- 승인 사용자만 보이는 수많은 조회에서 정지된 사람의 글과 프로필까지 사라진다.
CREATE TABLE IF NOT EXISTS "private"."profile_suspensions" (
    "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    "profile_id" bigint NOT NULL,
    "reason" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "suspended_by_profile_id" bigint,
    "ended_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "cancelled_by_profile_id" bigint,
    CONSTRAINT "profile_suspensions_reason" CHECK ((("reason" = "btrim"("reason")) AND ("char_length"("reason") >= 5) AND ("char_length"("reason") <= 300))),
    CONSTRAINT "profile_suspensions_duration" CHECK ((("expires_at" IS NULL) OR (("expires_at" > "created_at") AND ("expires_at" <= ("created_at" + '180 days'::interval))))),
    CONSTRAINT "profile_suspensions_end_shape" CHECK (((("ended_at" IS NULL) AND ("cancelled_at" IS NULL) AND ("cancelled_by_profile_id" IS NULL)) OR (("ended_at" = "expires_at") AND ("cancelled_at" IS NULL) AND ("cancelled_by_profile_id" IS NULL)) OR (("ended_at" = "cancelled_at") AND ("cancelled_at" IS NOT NULL))))
);

ALTER TABLE "private"."profile_suspensions" OWNER TO "postgres";

ALTER TABLE ONLY "private"."profile_suspensions"
    ADD CONSTRAINT "profile_suspensions_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "private"."profile_suspensions"
    ADD CONSTRAINT "profile_suspensions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "private"."profile_suspensions"
    ADD CONSTRAINT "profile_suspensions_suspended_by_fkey" FOREIGN KEY ("suspended_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "private"."profile_suspensions"
    ADD CONSTRAINT "profile_suspensions_cancelled_by_fkey" FOREIGN KEY ("cancelled_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "profile_suspensions_active_idx" ON "private"."profile_suspensions" USING "btree" ("profile_id") WHERE ("ended_at" IS NULL);

-- 프로필을 지울 때 외래 키 동작(cascade, set null)이 순차 탐색을 하지 않게 덮는다.
CREATE INDEX "profile_suspensions_profile_idx" ON "private"."profile_suspensions" USING "btree" ("profile_id");

CREATE INDEX "profile_suspensions_suspended_by_idx" ON "private"."profile_suspensions" USING "btree" ("suspended_by_profile_id") WHERE ("suspended_by_profile_id" IS NOT NULL);

CREATE INDEX "profile_suspensions_cancelled_by_idx" ON "private"."profile_suspensions" USING "btree" ("cancelled_by_profile_id") WHERE ("cancelled_by_profile_id" IS NOT NULL);

ALTER TABLE "private"."profile_suspensions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_suspensions_deny_client_access" ON "private"."profile_suspensions" USING (false) WITH CHECK (false);

-- 가입 반려. 반려는 계정 상태가 아니라 신청을 `draft`로 되돌리는 처리라 사유는 여기에만 남는다.
-- 처리한 관리자는 신청자에게 보이지 않아야 하므로 클라이언트 권한 없이 RPC로만 읽는다.
CREATE TABLE IF NOT EXISTS "private"."application_rejections" (
    "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    "profile_id" bigint NOT NULL,
    "reason" "text" NOT NULL,
    "rejected_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "rejected_by_profile_id" bigint,
    CONSTRAINT "application_rejections_reason" CHECK ((("reason" = "btrim"("reason")) AND ("char_length"("reason") >= 5) AND ("char_length"("reason") <= 300)))
);

ALTER TABLE "private"."application_rejections" OWNER TO "postgres";

ALTER TABLE ONLY "private"."application_rejections"
    ADD CONSTRAINT "application_rejections_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "private"."application_rejections"
    ADD CONSTRAINT "application_rejections_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "private"."application_rejections"
    ADD CONSTRAINT "application_rejections_rejected_by_fkey" FOREIGN KEY ("rejected_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;

CREATE INDEX "application_rejections_profile_idx" ON "private"."application_rejections" USING "btree" ("profile_id", "rejected_at" DESC);

CREATE INDEX "application_rejections_rejected_by_idx" ON "private"."application_rejections" USING "btree" ("rejected_by_profile_id") WHERE ("rejected_by_profile_id" IS NOT NULL);

ALTER TABLE "private"."application_rejections" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "application_rejections_deny_client_access" ON "private"."application_rejections" USING (false) WITH CHECK (false);

-- 신청자가 학교 프로필 설정에서 볼 가장 최근 반려. 다시 제출해 `draft`를 벗어나면 보이지 않는다.
-- 차단은 반려 기록을 남기므로, 반려 뒤 차단됐다가 풀린 `draft`에게 옛 사유를 보이지 않도록 마지막
-- 상태 전환이 그 반려였을 때만 돌려준다. 반려는 같은 트랜잭션에서 두 시각을 함께 남긴다.
CREATE OR REPLACE FUNCTION "public"."get_my_application_rejection"() RETURNS TABLE("reason" "text", "rejected_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select rejection.reason, rejection.rejected_at
  from public.profiles as profile
  join private.application_rejections as rejection on rejection.profile_id = profile.id
  where profile.auth_user_id = (select auth.uid())
    and profile.status = 'draft'
    and profile.deleted_at is null
    and rejection.rejected_at >= profile.status_updated_at
  order by rejection.rejected_at desc, rejection.id desc
  limit 1;
$$;

ALTER FUNCTION "public"."get_my_application_rejection"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_my_application_rejection"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_application_rejection"() TO "authenticated";

CREATE OR REPLACE FUNCTION "private"."profile_suspended"("p_profile_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from private.profile_suspensions as suspension
    where suspension.profile_id = p_profile_id
      and suspension.ended_at is null
      and (suspension.expires_at is null or suspension.expires_at > now())
  );
$$;

ALTER FUNCTION "private"."profile_suspended"("p_profile_id" bigint) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."current_profile_id"() RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select profile.id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id);
$$;

ALTER FUNCTION "private"."current_profile_id"() OWNER TO "postgres";

-- 정지된 사람은 `current_profile_id()`가 비므로 본인 계정으로 직접 찾는다. 처리한 관리자는 돌려주지 않는다.
CREATE OR REPLACE FUNCTION "public"."get_my_suspension"() RETURNS TABLE("reason" "text", "expires_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select suspension.reason, suspension.expires_at
  from private.profile_suspensions as suspension
  join public.profiles as profile on profile.id = suspension.profile_id
  where profile.auth_user_id = (select auth.uid())
    and profile.deleted_at is null
    and suspension.ended_at is null
    and (suspension.expires_at is null or suspension.expires_at > now());
$$;

ALTER FUNCTION "public"."get_my_suspension"() OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."permissions" (
    "key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."permissions" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."profile_permissions" (
    "profile_id" bigint NOT NULL,
    "permission_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."profile_permissions" OWNER TO "postgres";

ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("key");

ALTER TABLE ONLY "public"."profile_permissions"
    ADD CONSTRAINT "profile_permissions_pkey" PRIMARY KEY ("profile_id", "permission_key");

ALTER TABLE ONLY "public"."profile_permissions"
    ADD CONSTRAINT "profile_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."profile_permissions"
    ADD CONSTRAINT "profile_permissions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "permissions_select" ON "public"."permissions" FOR SELECT TO "authenticated" USING (("private"."current_profile_id"() IS NOT NULL));

ALTER TABLE "public"."profile_permissions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_permissions_select_own" ON "public"."profile_permissions" FOR SELECT TO "authenticated" USING (("profile_id" = "private"."current_profile_id"()));

REVOKE ALL ON FUNCTION "private"."profile_suspended"("p_profile_id" bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."current_profile_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."current_profile_id"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_my_suspension"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_suspension"() TO "authenticated";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."permissions" TO "service_role";
GRANT SELECT ON TABLE "public"."permissions" TO "authenticated";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profile_permissions" TO "service_role";
GRANT SELECT ON TABLE "public"."profile_permissions" TO "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."permissions" FROM "anon", "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."profile_permissions" FROM "anon", "authenticated";
