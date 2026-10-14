SET local check_function_bodies = off;

DROP FUNCTION "public"."donation_list_rounds"();

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
  target_round_id bigint;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'accepted profile required'
      USING ERRCODE = '42501';
  END IF;

  SELECT i.id, i.round_id
  INTO target_id, target_round_id
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

  -- Serialize one applicant's claims so parallel requests cannot pass the limit.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('donation-claims:' || caller_id, 0)
  );

  IF (
    SELECT count(*)
    FROM public.donation_claims AS c
    JOIN public.donation_items AS i
      ON i.id = c.item_id
    WHERE c.profile_id = caller_id
      AND c.cancelled_at IS NULL
      AND i.round_id = target_round_id
  ) >= 50 THEN
    RAISE EXCEPTION 'application limit reached'
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

CREATE OR REPLACE FUNCTION public.donation_list_rounds()
  RETURNS TABLE (
    id        bigint,
    title     text,
    opens_at  timestamp with time zone,
    closes_at timestamp with time zone,
    is_open   boolean
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
  SELECT
    r.id,
    r.title,
    r.opens_at,
    r.closes_at,
    now() >= r.opens_at AND now() < r.closes_at
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

CREATE INDEX donation_claims_item_id_idx ON public.donation_claims USING btree (item_id);

CREATE INDEX donation_claims_profile_id_idx ON public.donation_claims USING btree (profile_id);

CREATE INDEX donation_items_round_id_idx ON public.donation_items USING btree (round_id);

GRANT EXECUTE ON FUNCTION "public"."donation_list_rounds"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."donation_list_rounds"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."donation_list_rounds"() TO "postgres";
