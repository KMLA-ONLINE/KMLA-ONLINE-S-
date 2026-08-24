-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.


CREATE OR REPLACE FUNCTION "private"."prepare_gongang_schedule"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_profile_id bigint;
  korea_today date;
  next_monday date;
  next_sunday date;
  lock_key bigint;
begin
  select profile.id
  into caller_profile_id
  from public.profiles as profile
  join public.profile_permissions as permission
    on permission.profile_id = profile.id
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and permission.permission_key = 'gongang.manage';

  if not found then
    raise exception 'gongang manager permission required'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and (
    old.schedule_date is distinct from new.schedule_date
    or old.slot is distinct from new.slot
    or old.location is distinct from new.location
  ) then
    raise exception 'gongang schedule keys cannot be changed'
      using errcode = '22023';
  end if;

  korea_today := (now() at time zone 'Asia/Seoul')::date;
  next_monday :=
    korea_today + (8 - extract(isodow from korea_today)::integer);
  next_sunday := next_monday + 6;

  if new.schedule_date < next_monday
    or new.schedule_date > next_sunday
  then
    raise exception 'only next week can be configured'
      using errcode = '22023';
  end if;

  new.configured_by := caller_profile_id;
  new.updated_at := now();

  if new.reserved = false then
    new.detail := null;
  else
    new.detail := btrim(new.detail);
  end if;

  lock_key :=
    pg_catalog.hashtextextended(
      pg_catalog.concat_ws(
        '|',
        'gongang',
        new.slot,
        new.location,
        extract(dow from new.schedule_date)::integer::text
      ),
      0
    );

  perform pg_catalog.pg_advisory_xact_lock(lock_key);

  if new.reserved and exists (
    select 1
    from public.utility_reservations as reservation
    where reservation.mode = 'gongang'
      and reservation.recurring = false
      and reservation.reservation_date = new.schedule_date
      and reservation.slot = new.slot
      and reservation.location = new.location
  ) then
    raise exception 'reservation slot is already occupied'
      using errcode = '23505';
  end if;

  if new.reserved then
    update public.utility_reservations as reservation
    set recurring_until = new.schedule_date
    where reservation.mode = 'gongang'
      and reservation.recurring = true
      and reservation.slot = new.slot
      and reservation.location = new.location
      and reservation.reservation_date <= new.schedule_date
      and (
        reservation.recurring_until is null
        or reservation.recurring_until > new.schedule_date
      )
      and extract(dow from reservation.reservation_date)
        = extract(dow from new.schedule_date);
  end if;

  return new;
end;
$$;

ALTER FUNCTION "private"."prepare_gongang_schedule"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."prepare_utility_reservation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  caller_profile_id bigint;
  caller_profile_name text;
  caller_avatar_path text;
  korea_today date;
  current_monday date;
  first_manager_date date;
  lock_key bigint;
begin
  if auth.uid() is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  select profile.id, profile.name, profile.avatar_path
  into caller_profile_id, caller_profile_name, caller_avatar_path
  from public.profiles as profile
  where profile.id = private.current_profile_id();

  if not found then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  new.profile_id := caller_profile_id;
  new.applicant_name := caller_profile_name;
  new.avatar_path := caller_avatar_path;
  new.detail := btrim(new.detail);
  new.recurring_until := null;

  if new.mode = 'karaoke' then
    new.location := null;
    new.recurring := false;
  end if;

  korea_today := (now() at time zone 'Asia/Seoul')::date;
  current_monday :=
    korea_today - (extract(isodow from korea_today)::integer - 1);

  if new.reservation_date < korea_today
    or new.reservation_date < current_monday
    or new.reservation_date > current_monday + 6
  then
    raise exception 'utility reservations are limited to the current Korea week'
      using errcode = '22023';
  end if;

  lock_key :=
    pg_catalog.hashtextextended(
      pg_catalog.concat_ws(
        '|',
        new.mode,
        new.slot,
        coalesce(new.location, ''),
        extract(dow from new.reservation_date)::integer::text
      ),
      0
    );

  perform pg_catalog.pg_advisory_xact_lock(lock_key);

  if new.mode = 'gongang' and new.recurring then
    select min(schedule.schedule_date)
    into first_manager_date
    from public.gongang_schedule as schedule
    where schedule.reserved = true
      and schedule.slot = new.slot
      and schedule.location = new.location
      and schedule.schedule_date >= new.reservation_date
      and extract(dow from schedule.schedule_date)
        = extract(dow from new.reservation_date);

    new.recurring_until := first_manager_date;
  elsif new.mode = 'gongang' and exists (
    select 1
    from public.gongang_schedule as schedule
    where schedule.reserved = true
      and schedule.schedule_date = new.reservation_date
      and schedule.slot = new.slot
      and schedule.location = new.location
  ) then
    raise exception 'reserved by gongang manager'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.utility_reservations as reservation
    where reservation.mode = new.mode
      and reservation.slot = new.slot
      and reservation.location is not distinct from new.location
      and (
        (
          reservation.recurring = false
          and new.recurring = false
          and reservation.reservation_date = new.reservation_date
        )
        or
        (
          reservation.recurring = true
          and new.recurring = false
          and new.reservation_date >= reservation.reservation_date
          and (
            reservation.recurring_until is null
            or new.reservation_date < reservation.recurring_until
          )
          and extract(dow from new.reservation_date)
            = extract(dow from reservation.reservation_date)
        )
        or
        (
          reservation.recurring = false
          and new.recurring = true
          and reservation.reservation_date >= new.reservation_date
          and (
            new.recurring_until is null
            or reservation.reservation_date < new.recurring_until
          )
          and extract(dow from reservation.reservation_date)
            = extract(dow from new.reservation_date)
        )
        or
        (
          reservation.recurring = true
          and new.recurring = true
          and extract(dow from reservation.reservation_date)
            = extract(dow from new.reservation_date)
          and coalesce(reservation.recurring_until, 'infinity'::date)
            > new.reservation_date
          and coalesce(new.recurring_until, 'infinity'::date)
            > reservation.reservation_date
        )
      )
  ) then
    raise exception 'reservation slot is already occupied'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

ALTER FUNCTION "private"."prepare_utility_reservation"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."cancel_utility_reservation"("p_reservation_id" bigint, "p_effective_date" "date" DEFAULT NULL::"date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_profile_id bigint;
  korea_today date;
  reservation public.utility_reservations%rowtype;
begin
  select profile.id
  into caller_profile_id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if not found then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  select target.*
  into reservation
  from public.utility_reservations as target
  where target.id = p_reservation_id
  for update;

  if not found or reservation.profile_id <> caller_profile_id then
    raise exception 'reservation not found'
      using errcode = '42501';
  end if;

  korea_today := (now() at time zone 'Asia/Seoul')::date;

  if reservation.recurring = false then
    if reservation.reservation_date < korea_today then
      raise exception 'past utility reservations cannot be cancelled'
        using errcode = '22023';
    end if;

    delete from public.utility_reservations
    where id = reservation.id;
    return;
  end if;

  if p_effective_date is null
    or p_effective_date < korea_today
    or p_effective_date < reservation.reservation_date
    or extract(dow from p_effective_date)
      <> extract(dow from reservation.reservation_date)
  then
    raise exception 'invalid recurring cancellation date'
      using errcode = '22023';
  end if;

  update public.utility_reservations
  set recurring_until = least(
    coalesce(recurring_until, p_effective_date),
    p_effective_date
  )
  where id = reservation.id;
end;
$$;

ALTER FUNCTION "public"."cancel_utility_reservation"("p_reservation_id" bigint, "p_effective_date" "date") OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."gongang_schedule" (
    "schedule_date" "date" NOT NULL,
    "slot" "text" NOT NULL,
    "location" "text" NOT NULL,
    "reserved" boolean DEFAULT true NOT NULL,
    "configured_by" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "detail" "text",
    CONSTRAINT "gongang_schedule_detail_check" CHECK (((("reserved" = false) AND ("detail" IS NULL)) OR (("reserved" = true) AND ("detail" IS NOT NULL) AND (("char_length"("btrim"("detail")) >= 1) AND ("char_length"("btrim"("detail")) <= 200))))),
    CONSTRAINT "gongang_schedule_hourly_weekend_check" CHECK ((("slot" !~~ 'hour-%'::"text") OR (EXTRACT(isodow FROM "schedule_date") = ANY (ARRAY[(6)::numeric, (7)::numeric])))),
    CONSTRAINT "gongang_schedule_location_check" CHECK (("location" = ANY (ARRAY['floor_b1'::"text", 'floor_2'::"text", 'floor_4'::"text", 'floor_10'::"text"]))),
    CONSTRAINT "gongang_schedule_slot_check" CHECK (("slot" = ANY (ARRAY['study-1'::"text", 'honjeong-end'::"text", 'study-2'::"text", 'hour-8'::"text", 'hour-9'::"text", 'hour-10'::"text", 'hour-11'::"text", 'hour-12'::"text", 'hour-13'::"text", 'hour-14'::"text", 'hour-15'::"text", 'hour-16'::"text", 'hour-17'::"text", 'hour-18'::"text"])))
);

ALTER TABLE "public"."gongang_schedule" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."utility_reservations" (
    "id" bigint NOT NULL,
    "profile_id" bigint NOT NULL,
    "mode" "text" NOT NULL,
    "reservation_date" "date" NOT NULL,
    "slot" "text" NOT NULL,
    "location" "text",
    "detail" "text" NOT NULL,
    "recurring" boolean DEFAULT false NOT NULL,
    "applicant_name" "text" NOT NULL,
    "avatar_path" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "recurring_until" "date",
    CONSTRAINT "utility_reservations_detail_check" CHECK ((("char_length"("btrim"("detail")) >= 1) AND ("char_length"("btrim"("detail")) <= 200))),
    CONSTRAINT "utility_reservations_location_check" CHECK (((("mode" = 'gongang'::"text") AND ("location" IS NOT NULL) AND ("location" = ANY (ARRAY['floor_b1'::"text", 'floor_2'::"text", 'floor_4'::"text", 'floor_10'::"text"]))) OR (("mode" = 'karaoke'::"text") AND ("location" IS NULL)))),
    CONSTRAINT "utility_reservations_mode_check" CHECK (("mode" = ANY (ARRAY['gongang'::"text", 'karaoke'::"text"]))),
    CONSTRAINT "utility_reservations_recurring_check" CHECK ((("recurring" = false) OR ("mode" = 'gongang'::"text"))),
    CONSTRAINT "utility_reservations_slot_check" CHECK (((("mode" = 'gongang'::"text") AND (("slot" = ANY (ARRAY['study-1'::"text", 'honjeong-end'::"text", 'study-2'::"text"])) OR (("slot" = ANY (ARRAY['hour-8'::"text", 'hour-9'::"text", 'hour-10'::"text", 'hour-11'::"text", 'hour-12'::"text", 'hour-13'::"text", 'hour-14'::"text", 'hour-15'::"text", 'hour-16'::"text", 'hour-17'::"text", 'hour-18'::"text"])) AND (EXTRACT(isodow FROM "reservation_date") = ANY (ARRAY[(6)::numeric, (7)::numeric]))))) OR (("mode" = 'karaoke'::"text") AND ((("slot" = ANY (ARRAY['lunch'::"text", 'dinner'::"text"])) AND ((EXTRACT(isodow FROM "reservation_date") >= (1)::numeric) AND (EXTRACT(isodow FROM "reservation_date") <= (5)::numeric))) OR (("slot" = ANY (ARRAY['hour-8'::"text", 'hour-9'::"text", 'hour-10'::"text", 'hour-11'::"text", 'hour-12'::"text", 'hour-13'::"text", 'hour-14'::"text", 'hour-15'::"text", 'hour-16'::"text", 'hour-17'::"text", 'hour-18'::"text"])) AND (EXTRACT(isodow FROM "reservation_date") = ANY (ARRAY[(6)::numeric, (7)::numeric])))))))
);

ALTER TABLE "public"."utility_reservations" OWNER TO "postgres";

COMMENT ON COLUMN "public"."utility_reservations"."recurring_until" IS 'Exclusive end date for a recurring reservation. NULL means no scheduled end.';

ALTER TABLE "public"."utility_reservations" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."utility_reservations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY "public"."gongang_schedule"
    ADD CONSTRAINT "gongang_schedule_pkey" PRIMARY KEY ("schedule_date", "slot", "location");

ALTER TABLE ONLY "public"."utility_reservations"
    ADD CONSTRAINT "utility_reservations_pkey" PRIMARY KEY ("id");

CREATE INDEX "utility_reservations_date_idx" ON "public"."utility_reservations" USING "btree" ("reservation_date");

CREATE OR REPLACE TRIGGER "gongang_schedule_prepare" BEFORE INSERT OR UPDATE ON "public"."gongang_schedule" FOR EACH ROW EXECUTE FUNCTION "private"."prepare_gongang_schedule"();

CREATE OR REPLACE TRIGGER "utility_reservations_prepare" BEFORE INSERT ON "public"."utility_reservations" FOR EACH ROW EXECUTE FUNCTION "private"."prepare_utility_reservation"();

ALTER TABLE ONLY "public"."gongang_schedule"
    ADD CONSTRAINT "gongang_schedule_configured_by_fkey" FOREIGN KEY ("configured_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."utility_reservations"
    ADD CONSTRAINT "utility_reservations_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE "public"."gongang_schedule" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gongang_schedule_delete_manager" ON "public"."gongang_schedule" FOR DELETE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."profile_permissions" "permission"
  WHERE (("permission"."profile_id" = "private"."current_profile_id"()) AND ("permission"."permission_key" = 'gongang.manage'::"text")))) AND (("schedule_date" >= ((("now"() AT TIME ZONE 'Asia/Seoul'::"text"))::"date" + (8 - (EXTRACT(isodow FROM (("now"() AT TIME ZONE 'Asia/Seoul'::"text"))::"date"))::integer))) AND ("schedule_date" <= ((("now"() AT TIME ZONE 'Asia/Seoul'::"text"))::"date" + (14 - (EXTRACT(isodow FROM (("now"() AT TIME ZONE 'Asia/Seoul'::"text"))::"date"))::integer))))));

CREATE POLICY "gongang_schedule_insert_manager" ON "public"."gongang_schedule" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profile_permissions" "permission"
  WHERE (("permission"."profile_id" = "private"."current_profile_id"()) AND ("permission"."permission_key" = 'gongang.manage'::"text")))));

CREATE POLICY "gongang_schedule_select" ON "public"."gongang_schedule" FOR SELECT TO "authenticated" USING (("private"."current_profile_id"() IS NOT NULL));

CREATE POLICY "gongang_schedule_update_manager" ON "public"."gongang_schedule" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profile_permissions" "permission"
  WHERE (("permission"."profile_id" = "private"."current_profile_id"()) AND ("permission"."permission_key" = 'gongang.manage'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profile_permissions" "permission"
  WHERE (("permission"."profile_id" = "private"."current_profile_id"()) AND ("permission"."permission_key" = 'gongang.manage'::"text")))));

ALTER TABLE "public"."utility_reservations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "utility_reservations_insert" ON "public"."utility_reservations" FOR INSERT TO "authenticated" WITH CHECK (("profile_id" = "private"."current_profile_id"()));

CREATE POLICY "utility_reservations_select" ON "public"."utility_reservations" FOR SELECT TO "authenticated" USING (("private"."current_profile_id"() IS NOT NULL));

REVOKE ALL ON FUNCTION "public"."cancel_utility_reservation"("p_reservation_id" bigint, "p_effective_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_utility_reservation"("p_reservation_id" bigint, "p_effective_date" "date") TO "authenticated";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."gongang_schedule" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."gongang_schedule" TO "authenticated";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."utility_reservations" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."utility_reservations" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."utility_reservations_id_seq" FROM "anon", "authenticated", "service_role";
GRANT USAGE ON SEQUENCE "public"."utility_reservations_id_seq" TO "authenticated", "service_role";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."utility_reservations" FROM "anon", "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."gongang_schedule" FROM "anon", "authenticated";
