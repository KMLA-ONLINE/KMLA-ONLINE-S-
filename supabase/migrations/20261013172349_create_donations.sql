SET local check_function_bodies = off;

CREATE TABLE "public"."donation_claims" (
  "id"           bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "item_id"      bigint                   NOT NULL,
  "profile_id"   bigint,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "cancelled_at" timestamp with time zone,
  CONSTRAINT "donation_claims_check" CHECK (((cancelled_at IS NULL) OR (cancelled_at >= created_at))),
  CONSTRAINT "donation_claims_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."donation_claims"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."donation_claims" FROM "anon", "authenticated";

CREATE TABLE "public"."donation_items" (
  "id"           bigint  GENERATED ALWAYS AS IDENTITY NOT NULL,
  "round_id"     bigint  NOT NULL,
  "category"     text    NOT NULL,
  "name"         text    NOT NULL,
  "detail"       text,
  "donor_name"   text,
  "source_sheet" text    NOT NULL,
  "source_row"   integer NOT NULL,
  CONSTRAINT "donation_items_category_check" CHECK (((length(btrim(category)) >= 1) AND (length(btrim(category)) <= 60))),
  CONSTRAINT "donation_items_detail_check" CHECK (((detail IS NULL) OR (length(detail) <= 200))),
  CONSTRAINT "donation_items_donor_name_check" CHECK (((donor_name IS NULL) OR (length(donor_name) <= 100))),
  CONSTRAINT "donation_items_name_check" CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 300))),
  CONSTRAINT "donation_items_pkey" PRIMARY KEY (id),
  CONSTRAINT "donation_items_source_row_check" CHECK ((source_row > 0))
);

ALTER TABLE "public"."donation_items"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."donation_items" FROM "anon", "authenticated";

CREATE TABLE "public"."donation_rounds" (
  "id"         bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "title"      text                     NOT NULL,
  "opens_at"   timestamp with time zone NOT NULL,
  "closes_at"  timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "donation_rounds_check" CHECK ((opens_at < closes_at)),
  CONSTRAINT "donation_rounds_pkey" PRIMARY KEY (id),
  CONSTRAINT "donation_rounds_title_check" CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 100)))
);

ALTER TABLE "public"."donation_rounds"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."donation_rounds" FROM "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.donation_cancel_claim (
  p_item_id bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  caller_id bigint := private.current_profile_id();
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'accepted profile required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.donation_claims AS claim
  SET cancelled_at = now()
  FROM public.donation_items AS i
  JOIN public.donation_rounds AS r
    ON r.id = i.round_id
  WHERE claim.item_id = p_item_id
    AND claim.item_id = i.id
    AND claim.profile_id = caller_id
    AND claim.cancelled_at IS NULL
    AND now() >= r.opens_at
    AND now() < r.closes_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active application not found or period closed'
      USING ERRCODE = '22023';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."donation_cancel_claim"(bigint) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.donation_claim_item (
  p_item_id bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  caller_id bigint := private.current_profile_id();
  target_id bigint;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'accepted profile required'
      USING ERRCODE = '42501';
  END IF;

  SELECT i.id
  INTO target_id
  FROM public.donation_items AS i
  JOIN public.donation_rounds AS r
    ON r.id = i.round_id
  WHERE i.id = p_item_id
    AND now() >= r.opens_at
    AND now() < r.closes_at
  FOR SHARE OF r, i;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'applications are closed'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.donation_claims (
    item_id, profile_id
  )
  VALUES (
    target_id, caller_id
  );

EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'item already claimed'
    USING ERRCODE = '23505';
END;
$function$;

REVOKE ALL ON FUNCTION "public"."donation_claim_item"(bigint) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.donation_create_round (
  p_title     text,
  p_opens_at  timestamp with time zone,
  p_closes_at timestamp with time zone
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  new_id bigint;
BEGIN
  PERFORM private.require_app_admin();

  IF p_title IS NULL
    OR length(btrim(p_title)) NOT BETWEEN 1 AND 100
    OR p_opens_at IS NULL
    OR p_closes_at IS NULL
    OR p_opens_at >= p_closes_at
  THEN
    RAISE EXCEPTION 'invalid donation round'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('donation-rounds', 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.donation_rounds AS r
    WHERE p_opens_at < r.closes_at
      AND p_closes_at > r.opens_at
  ) THEN
    RAISE EXCEPTION 'donation rounds cannot overlap'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.donation_rounds (
    title, opens_at, closes_at
  )
  VALUES (
    btrim(p_title), p_opens_at, p_closes_at
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."donation_create_round"(text, timestamp WITH time zone, timestamp WITH time zone) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.donation_import_items (
  p_round_id bigint,
  p_items    jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  target public.donation_rounds%ROWTYPE;
  entry jsonb;
  pos integer := 0;
BEGIN
  PERFORM private.require_app_admin();

  SELECT *
  INTO target
  FROM public.donation_rounds
  WHERE id = p_round_id
  FOR UPDATE;

  IF NOT FOUND OR now() >= target.closes_at THEN
    RAISE EXCEPTION 'round not found or closed'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.donation_claims AS c
    JOIN public.donation_items AS i ON i.id = c.item_id
    WHERE i.round_id = p_round_id
  ) THEN
    RAISE EXCEPTION 'items cannot change after applications'
      USING ERRCODE = '55000';
  END IF;

  IF p_items IS NULL
    OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 3000
  THEN
    RAISE EXCEPTION '1 to 3000 items required'
      USING ERRCODE = '22023';
  END IF;

  FOR entry IN
    SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    pos := pos + 1;

    IF jsonb_typeof(entry) <> 'object'
      OR jsonb_typeof(entry->'name') IS DISTINCT FROM 'string'
      OR length(btrim(entry->>'name')) NOT BETWEEN 1 AND 300
      OR jsonb_typeof(entry->'category') IS DISTINCT FROM 'string'
      OR length(btrim(entry->>'category')) NOT BETWEEN 1 AND 60
      OR jsonb_typeof(entry->'sourceSheet') IS DISTINCT FROM 'string'
      OR jsonb_typeof(entry->'sourceRow') IS DISTINCT FROM 'number'
      OR (entry->>'sourceRow') !~ '^[1-9][0-9]*$'
      OR length(coalesce(entry->>'detail', '')) > 200
      OR length(coalesce(entry->>'donorName', '')) > 100
    THEN
      RAISE EXCEPTION 'invalid donation item at upload row %', pos
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  DELETE FROM public.donation_items
  WHERE round_id = p_round_id;

  INSERT INTO public.donation_items (
    round_id, category, name, detail,
    donor_name, source_sheet, source_row
  )
  SELECT
    p_round_id,
    btrim(value->>'category'),
    btrim(value->>'name'),
    nullif(btrim(value->>'detail'), ''),
    nullif(btrim(value->>'donorName'), ''),
    btrim(value->>'sourceSheet'),
    (value->>'sourceRow')::integer
  FROM jsonb_array_elements(p_items);

  RETURN jsonb_array_length(p_items);
END;
$function$;

REVOKE ALL ON FUNCTION "public"."donation_import_items"(bigint, jsonb) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.donation_list_claims (
  p_round_id bigint
)
  RETURNS TABLE (
    item_id          bigint,
    category         text,
    item_name        text,
    detail           text,
    donor_name       text,
    applicant        text,
    applicant_pub_id text,
    applicant_cohort smallint,
    applied_at       timestamp with time zone,
    cancelled_at     timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
  PERFORM private.require_app_admin();

  RETURN QUERY
  SELECT
    i.id,
    i.category,
    i.name,
    i.detail,
    i.donor_name,
    p.name,
    p.pub_id,
    p.cohort,
    c.created_at,
    c.cancelled_at
  FROM public.donation_items AS i
  LEFT JOIN public.donation_claims AS c
    ON c.item_id = i.id
  LEFT JOIN public.profiles AS p
    ON p.id = c.profile_id
  WHERE i.round_id = p_round_id
  ORDER BY i.id, c.created_at, c.id;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."donation_list_claims"(bigint) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.donation_list_items (
  p_round_id bigint
)
  RETURNS TABLE (
    id         bigint,
    category   text,
    name       text,
    detail     text,
    donor_name text,
    is_claimed boolean,
    is_mine    boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  caller_id bigint := private.current_profile_id();
  admin_access boolean;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'accepted profile required'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.role = 'admin'
  INTO admin_access
  FROM public.profiles AS p
  WHERE p.id = caller_id;

  IF NOT admin_access AND NOT EXISTS (
    SELECT 1
    FROM public.donation_rounds AS r
    WHERE r.id = p_round_id
      AND now() >= r.opens_at
      AND now() < r.closes_at
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    item.id,
    item.category,
    item.name,
    item.detail,
    CASE
      WHEN admin_access THEN item.donor_name
      ELSE NULL::text
    END,
    claim.id IS NOT NULL,
    COALESCE(claim.profile_id = caller_id, false)
  FROM public.donation_items AS item
  LEFT JOIN public.donation_claims AS claim
    ON claim.item_id = item.id
    AND claim.cancelled_at IS NULL
  WHERE item.round_id = p_round_id
  ORDER BY item.id;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."donation_list_items"(bigint) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.donation_list_rounds()
  RETURNS TABLE (
    id        bigint,
    title     text,
    opens_at  timestamp with time zone,
    closes_at timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  admin_access boolean;
BEGIN
  IF private.current_profile_id() IS NULL THEN
    RAISE EXCEPTION 'accepted profile required'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.role = 'admin'
  INTO admin_access
  FROM public.profiles AS p
  WHERE p.id = private.current_profile_id();

  RETURN QUERY
  SELECT r.id, r.title, r.opens_at, r.closes_at
  FROM public.donation_rounds AS r
  WHERE admin_access OR r.id = COALESCE(
    (
      SELECT current_round.id
      FROM public.donation_rounds AS current_round
      WHERE now() >= current_round.opens_at
        AND now() < current_round.closes_at
      ORDER BY current_round.id DESC
      LIMIT 1
    ),
    (
      SELECT last_round.id
      FROM public.donation_rounds AS last_round
      ORDER BY last_round.id DESC
      LIMIT 1
    )
  )
  ORDER BY r.id DESC;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."donation_list_rounds"() FROM PUBLIC, "anon", "service_role";

ALTER TABLE "public"."donation_claims"
  ADD CONSTRAINT "donation_claims_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."donation_claims"
  ADD CONSTRAINT "donation_claims_item_id_fkey" FOREIGN KEY (item_id) REFERENCES public.donation_items(id);

ALTER TABLE "public"."donation_items"
  ADD CONSTRAINT "donation_items_round_id_fkey" FOREIGN KEY (round_id) REFERENCES public.donation_rounds(id);

CREATE UNIQUE INDEX donation_claims_one_active_per_item ON public.donation_claims USING btree (item_id)
  WHERE (cancelled_at IS NULL);

GRANT EXECUTE ON FUNCTION "public"."donation_cancel_claim"(bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."donation_cancel_claim"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."donation_cancel_claim"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."donation_claim_item"(bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."donation_claim_item"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."donation_claim_item"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."donation_create_round"(text, timestamp WITH time zone, timestamp WITH time zone) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."donation_create_round"(text, timestamp WITH time zone, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."donation_create_round"(text, timestamp WITH time zone, timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."donation_import_items"(bigint, jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."donation_import_items"(bigint, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."donation_import_items"(bigint, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."donation_list_claims"(bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."donation_list_claims"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."donation_list_claims"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."donation_list_items"(bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."donation_list_items"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."donation_list_items"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."donation_list_rounds"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."donation_list_rounds"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."donation_list_rounds"() TO "postgres";

REVOKE ALL ON SEQUENCE "public"."donation_claims_id_seq" FROM "anon";

GRANT UPDATE ON SEQUENCE "public"."donation_claims_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."donation_claims_id_seq" FROM "authenticated";

GRANT UPDATE ON SEQUENCE "public"."donation_claims_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."donation_claims_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."donation_claims_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."donation_claims_id_seq" FROM "service_role";

GRANT UPDATE ON SEQUENCE "public"."donation_claims_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."donation_items_id_seq" FROM "anon";

GRANT UPDATE ON SEQUENCE "public"."donation_items_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."donation_items_id_seq" FROM "authenticated";

GRANT UPDATE ON SEQUENCE "public"."donation_items_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."donation_items_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."donation_items_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."donation_items_id_seq" FROM "service_role";

GRANT UPDATE ON SEQUENCE "public"."donation_items_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."donation_rounds_id_seq" FROM "anon";

GRANT UPDATE ON SEQUENCE "public"."donation_rounds_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."donation_rounds_id_seq" FROM "authenticated";

GRANT UPDATE ON SEQUENCE "public"."donation_rounds_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."donation_rounds_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."donation_rounds_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."donation_rounds_id_seq" FROM "service_role";

GRANT UPDATE ON SEQUENCE "public"."donation_rounds_id_seq" TO "service_role";

REVOKE ALL ON TABLE "public"."donation_claims" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."donation_claims" TO "postgres";

REVOKE ALL ON TABLE "public"."donation_claims" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."donation_claims" TO "service_role";

REVOKE ALL ON TABLE "public"."donation_items" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."donation_items" TO "postgres";

REVOKE ALL ON TABLE "public"."donation_items" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."donation_items" TO "service_role";

REVOKE ALL ON TABLE "public"."donation_rounds" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."donation_rounds" TO "postgres";

REVOKE ALL ON TABLE "public"."donation_rounds" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."donation_rounds" TO "service_role";


-- Only privileged database functions may advance donation IDs.
REVOKE ALL ON SEQUENCE
  public.donation_rounds_id_seq,
  public.donation_items_id_seq,
  public.donation_claims_id_seq
FROM PUBLIC, anon, authenticated;
