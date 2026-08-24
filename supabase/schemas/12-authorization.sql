-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.


CREATE OR REPLACE FUNCTION "private"."current_profile_id"() RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select profile.id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null;
$$;

ALTER FUNCTION "private"."current_profile_id"() OWNER TO "postgres";

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

CREATE POLICY "permissions_select" ON "public"."permissions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "profile"
  WHERE (("profile"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profile"."status" = 'accepted'::"public"."profile_status") AND ("profile"."deleted_at" IS NULL)))));

ALTER TABLE "public"."profile_permissions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_permissions_select_own" ON "public"."profile_permissions" FOR SELECT TO "authenticated" USING (("profile_id" = ( SELECT "profile"."id"
   FROM "public"."profiles" "profile"
  WHERE (("profile"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profile"."status" = 'accepted'::"public"."profile_status") AND ("profile"."deleted_at" IS NULL)))));

REVOKE ALL ON FUNCTION "private"."current_profile_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."current_profile_id"() TO "authenticated";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."permissions" TO "service_role";
GRANT SELECT ON TABLE "public"."permissions" TO "authenticated";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profile_permissions" TO "service_role";
GRANT SELECT ON TABLE "public"."profile_permissions" TO "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."permissions" FROM "anon", "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."profile_permissions" FROM "anon", "authenticated";
