CREATE TABLE public.donation_rounds (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 100),
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (opens_at < closes_at)
);

CREATE TABLE public.donation_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  round_id bigint NOT NULL REFERENCES public.donation_rounds(id),
  category text NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 60),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 300),
  detail text,
  donor_name text,
  source_sheet text NOT NULL,
  source_row integer NOT NULL CHECK (source_row > 0),
  CHECK (detail IS NULL OR length(detail) <= 200),
  CHECK (donor_name IS NULL OR length(donor_name) <= 100)
);

CREATE TABLE public.donation_claims (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id bigint NOT NULL REFERENCES public.donation_items(id),
  profile_id bigint REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CHECK (cancelled_at IS NULL OR cancelled_at >= created_at)
);

CREATE UNIQUE INDEX donation_claims_one_active_per_item
  ON public.donation_claims(item_id)
  WHERE cancelled_at IS NULL;

CREATE INDEX donation_items_round_id_idx
  ON public.donation_items(round_id);

CREATE INDEX donation_claims_item_id_idx
  ON public.donation_claims(item_id);

CREATE INDEX donation_claims_profile_id_idx
  ON public.donation_claims(profile_id);

ALTER TABLE public.donation_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donation_claims ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.donation_rounds,
  public.donation_items,
  public.donation_claims
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.donation_list_rounds()
RETURNS TABLE(
  id bigint,
  title text,
  opens_at timestamptz,
  closes_at timestamptz,
  is_open boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.donation_list_items(
  p_round_id bigint
)
RETURNS TABLE(
  id bigint,
  category text,
  name text,
  detail text,
  donor_name text,
  is_claimed boolean,
  is_mine boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.donation_create_round(
  p_title text,
  p_opens_at timestamptz,
  p_closes_at timestamptz
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.donation_import_items(
  p_round_id bigint,
  p_items jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
    SELECT 1 FROM public.donation_items WHERE round_id = p_round_id
  ) THEN
    RAISE EXCEPTION 'items already imported'
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
$$;

CREATE OR REPLACE FUNCTION public.donation_claim_item(
  p_item_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.donation_cancel_claim(
  p_item_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.donation_list_claims(
  p_round_id bigint
)
RETURNS TABLE(
  item_id bigint,
  category text,
  item_name text,
  detail text,
  donor_name text,
  applicant text,
  applicant_pub_id text,
  applicant_cohort smallint,
  applied_at timestamptz,
  cancelled_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.donation_list_rounds()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.donation_list_items(bigint)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.donation_create_round(
  text, timestamptz, timestamptz
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.donation_import_items(
  bigint, jsonb
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.donation_claim_item(bigint)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.donation_cancel_claim(bigint)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.donation_list_claims(bigint)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.donation_list_rounds()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.donation_list_items(bigint)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.donation_create_round(
  text, timestamptz, timestamptz
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.donation_import_items(
  bigint, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.donation_claim_item(bigint)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.donation_cancel_claim(bigint)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.donation_list_claims(bigint)
  TO authenticated;


-- Only privileged database functions may advance donation IDs.
REVOKE ALL ON SEQUENCE
  public.donation_rounds_id_seq,
  public.donation_items_id_seq,
  public.donation_claims_id_seq
FROM PUBLIC, anon, authenticated;

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


REVOKE ALL ON FUNCTION public.donation_update_round(
  bigint, text, timestamptz, timestamptz
) FROM PUBLIC, anon;


GRANT EXECUTE ON FUNCTION public.donation_update_round(
  bigint, text, timestamptz, timestamptz
) TO authenticated;


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
