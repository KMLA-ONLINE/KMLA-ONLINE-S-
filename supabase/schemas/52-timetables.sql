-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.


CREATE OR REPLACE FUNCTION "private"."is_valid_timetable_semesters"("timetable" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE STRICT
    SET "search_path" TO ''
    AS $$
declare
  semester_key text;
  course jsonb;
  meeting jsonb;
  meeting_day numeric;
  meeting_start numeric;
  meeting_end numeric;
begin
  if pg_catalog.jsonb_typeof(timetable) <> 'object' then
    return false;
  end if;

  foreach semester_key in array array[
    '1-1', '1-2', '2-1', '2-2', '3-1', '3-2'
  ]
  loop
    if pg_catalog.jsonb_typeof(timetable -> semester_key)
      is distinct from 'array'
    then
      return false;
    end if;

    for course in
      select element
      from pg_catalog.jsonb_array_elements(
        timetable -> semester_key
      ) as courses(element)
    loop
      if pg_catalog.jsonb_typeof(course) is distinct from 'object'
        or pg_catalog.jsonb_typeof(course -> 'id') is distinct from 'string'
        or pg_catalog.jsonb_typeof(course -> 'name') is distinct from 'string'
        or pg_catalog.jsonb_typeof(course -> 'color') is distinct from 'number'
        or pg_catalog.jsonb_typeof(course -> 'room') is distinct from 'string'
        or pg_catalog.jsonb_typeof(course -> 'meetings') is distinct from 'array'
      then
        return false;
      end if;

      for meeting in
        select element
        from pg_catalog.jsonb_array_elements(
          course -> 'meetings'
        ) as meetings(element)
      loop
        if pg_catalog.jsonb_typeof(meeting) is distinct from 'object'
          or pg_catalog.jsonb_typeof(meeting -> 'id') is distinct from 'string'
          or pg_catalog.jsonb_typeof(meeting -> 'day') is distinct from 'number'
          or pg_catalog.jsonb_typeof(meeting -> 'start') is distinct from 'number'
          or pg_catalog.jsonb_typeof(meeting -> 'end') is distinct from 'number'
        then
          return false;
        end if;

        meeting_day := (meeting ->> 'day')::numeric;
        meeting_start := (meeting ->> 'start')::numeric;
        meeting_end := (meeting ->> 'end')::numeric;

        if meeting_day <> pg_catalog.trunc(meeting_day)
          or meeting_day < 0
          or meeting_day > 4
          or meeting_start <> pg_catalog.trunc(meeting_start)
          or meeting_start < 1
          or meeting_start > 8
          or meeting_end <> pg_catalog.trunc(meeting_end)
          or meeting_end < meeting_start
          or meeting_end > 8
          or (meeting_start <= 4 and meeting_end >= 5)
        then
          return false;
        end if;
      end loop;
    end loop;
  end loop;

  return true;
end;
$$;

ALTER FUNCTION "private"."is_valid_timetable_semesters"("timetable" "jsonb") OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."user_timetables" (
    "profile_id" bigint NOT NULL,
    "active_semester" "text" DEFAULT '1-1'::"text" NOT NULL,
    "semesters" "jsonb" DEFAULT '{"1-1": [], "1-2": [], "2-1": [], "2-2": [], "3-1": [], "3-2": []}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_timetables_json_check" CHECK ("private"."is_valid_timetable_semesters"("semesters")),
    CONSTRAINT "user_timetables_semester_check" CHECK (("active_semester" = ANY (ARRAY['1-1'::"text", '1-2'::"text", '2-1'::"text", '2-2'::"text", '3-1'::"text", '3-2'::"text"])))
);

ALTER TABLE "public"."user_timetables" OWNER TO "postgres";

ALTER TABLE ONLY "public"."user_timetables"
    ADD CONSTRAINT "user_timetables_pkey" PRIMARY KEY ("profile_id");

ALTER TABLE ONLY "public"."user_timetables"
    ADD CONSTRAINT "user_timetables_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

CREATE OR REPLACE TRIGGER "user_timetables_set_updated_at" BEFORE INSERT OR UPDATE ON "public"."user_timetables" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();

ALTER TABLE "public"."user_timetables" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_timetables_insert_own" ON "public"."user_timetables" FOR INSERT TO "authenticated" WITH CHECK (("profile_id" = "private"."current_profile_id"()));

CREATE POLICY "user_timetables_select_own" ON "public"."user_timetables" FOR SELECT TO "authenticated" USING (("profile_id" = "private"."current_profile_id"()));

CREATE POLICY "user_timetables_update_own" ON "public"."user_timetables" FOR UPDATE TO "authenticated" USING (("profile_id" = "private"."current_profile_id"())) WITH CHECK (("profile_id" = "private"."current_profile_id"()));

REVOKE ALL ON FUNCTION "private"."is_valid_timetable_semesters"("timetable" "jsonb") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "private"."is_valid_timetable_semesters"("timetable" "jsonb") TO "authenticated", "service_role";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_timetables" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."user_timetables" TO "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."user_timetables" FROM "anon", "authenticated";
