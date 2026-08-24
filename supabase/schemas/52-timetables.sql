-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.


CREATE TABLE IF NOT EXISTS "public"."user_timetables" (
    "profile_id" bigint NOT NULL,
    "active_semester" "text" DEFAULT '1-1'::"text" NOT NULL,
    "semesters" "jsonb" DEFAULT '{"1-1": [], "1-2": [], "2-1": [], "2-2": [], "3-1": [], "3-2": []}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_timetables_json_check" CHECK ((("jsonb_typeof"("semesters") = 'object'::"text") AND ("jsonb_typeof"(("semesters" -> '1-1'::"text")) = 'array'::"text") AND ("jsonb_typeof"(("semesters" -> '1-2'::"text")) = 'array'::"text") AND ("jsonb_typeof"(("semesters" -> '2-1'::"text")) = 'array'::"text") AND ("jsonb_typeof"(("semesters" -> '2-2'::"text")) = 'array'::"text") AND ("jsonb_typeof"(("semesters" -> '3-1'::"text")) = 'array'::"text") AND ("jsonb_typeof"(("semesters" -> '3-2'::"text")) = 'array'::"text"))),
    CONSTRAINT "user_timetables_semester_check" CHECK (("active_semester" = ANY (ARRAY['1-1'::"text", '1-2'::"text", '2-1'::"text", '2-2'::"text", '3-1'::"text", '3-2'::"text"])))
);

ALTER TABLE "public"."user_timetables" OWNER TO "postgres";

ALTER TABLE ONLY "public"."user_timetables"
    ADD CONSTRAINT "user_timetables_pkey" PRIMARY KEY ("profile_id");

ALTER TABLE ONLY "public"."user_timetables"
    ADD CONSTRAINT "user_timetables_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE "public"."user_timetables" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_timetables_insert_own" ON "public"."user_timetables" FOR INSERT TO "authenticated" WITH CHECK (("profile_id" = ( SELECT "profile"."id"
   FROM "public"."profiles" "profile"
  WHERE (("profile"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profile"."status" = 'accepted'::"public"."profile_status") AND ("profile"."deleted_at" IS NULL)))));

CREATE POLICY "user_timetables_select_own" ON "public"."user_timetables" FOR SELECT TO "authenticated" USING (("profile_id" = ( SELECT "profile"."id"
   FROM "public"."profiles" "profile"
  WHERE (("profile"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profile"."status" = 'accepted'::"public"."profile_status") AND ("profile"."deleted_at" IS NULL)))));

CREATE POLICY "user_timetables_update_own" ON "public"."user_timetables" FOR UPDATE TO "authenticated" USING (("profile_id" = ( SELECT "profile"."id"
   FROM "public"."profiles" "profile"
  WHERE (("profile"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profile"."status" = 'accepted'::"public"."profile_status") AND ("profile"."deleted_at" IS NULL))))) WITH CHECK (("profile_id" = ( SELECT "profile"."id"
   FROM "public"."profiles" "profile"
  WHERE (("profile"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profile"."status" = 'accepted'::"public"."profile_status") AND ("profile"."deleted_at" IS NULL)))));

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_timetables" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."user_timetables" TO "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."user_timetables" FROM "anon", "authenticated";
