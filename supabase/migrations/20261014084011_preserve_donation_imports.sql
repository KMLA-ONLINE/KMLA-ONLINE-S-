SET local check_function_bodies = off;

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
$function$;
