CREATE OR REPLACE FUNCTION public.donation_list_claimed_by(
  p_round_id bigint
)
RETURNS TABLE (
  item_id bigint,
  applicant_name text,
  applicant_cohort smallint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id bigint := private.current_profile_id();
  is_admin boolean;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'accepted profile required'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.role = 'admin'
  INTO is_admin
  FROM public.profiles AS p
  WHERE p.id = caller_id;

  IF NOT COALESCE(is_admin, false) AND NOT EXISTS (
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
    c.item_id,
    p.name,
    p.cohort
  FROM public.donation_claims AS c
  JOIN public.donation_items AS i
    ON i.id = c.item_id
  LEFT JOIN public.profiles AS p
    ON p.id = c.profile_id
    AND p.status = 'accepted'
    AND p.deleted_at IS NULL
  WHERE i.round_id = p_round_id
    AND c.cancelled_at IS NULL
  ORDER BY c.item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.donation_list_claimed_by(bigint)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.donation_list_claimed_by(bigint)
TO authenticated;
