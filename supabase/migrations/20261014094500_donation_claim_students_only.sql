SET local check_function_bodies = off;

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

  -- Only current students apply; admin rights do not grant eligibility.
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = caller_id
      AND p.type = 'student'
  ) THEN
    RAISE EXCEPTION 'only students can apply'
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
