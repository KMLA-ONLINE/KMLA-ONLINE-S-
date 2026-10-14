CREATE OR REPLACE FUNCTION public.donation_update_round(
  p_round_id bigint,
  p_title text,
  p_opens_at timestamptz,
  p_closes_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_app_admin();

  IF p_round_id IS NULL
    OR p_title IS NULL
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

  PERFORM 1
  FROM public.donation_rounds
  WHERE id = p_round_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'donation round not found'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.donation_claims AS c
    JOIN public.donation_items AS i
      ON i.id = c.item_id
    WHERE i.round_id = p_round_id
  ) THEN
    RAISE EXCEPTION 'round has application history'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.donation_rounds AS r
    WHERE r.id <> p_round_id
      AND p_opens_at < r.closes_at
      AND p_closes_at > r.opens_at
  ) THEN
    RAISE EXCEPTION 'donation rounds cannot overlap'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.donation_rounds
  SET
    title = btrim(p_title),
    opens_at = p_opens_at,
    closes_at = p_closes_at
  WHERE id = p_round_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.donation_delete_round(
  p_round_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_app_admin();

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('donation-rounds', 0)
  );

  PERFORM 1
  FROM public.donation_rounds
  WHERE id = p_round_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'donation round not found'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.donation_claims AS c
    JOIN public.donation_items AS i
      ON i.id = c.item_id
    WHERE i.round_id = p_round_id
  ) THEN
    RAISE EXCEPTION 'round has application history'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.donation_items
  WHERE round_id = p_round_id;

  DELETE FROM public.donation_rounds
  WHERE id = p_round_id;
END;
$$;

REVOKE ALL ON FUNCTION public.donation_update_round(
  bigint, text, timestamptz, timestamptz
) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.donation_delete_round(
  bigint
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.donation_update_round(
  bigint, text, timestamptz, timestamptz
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.donation_delete_round(
  bigint
) TO authenticated;
