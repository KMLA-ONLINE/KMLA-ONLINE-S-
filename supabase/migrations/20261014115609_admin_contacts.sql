SET local check_function_bodies = off;

CREATE TABLE "public"."admin_contacts" (
  "position" smallint NOT NULL,
  "kind"     text     NOT NULL,
  "label"    text     NOT NULL,
  "value"    text     NOT NULL,
  CONSTRAINT "admin_contacts_kind_check" CHECK ((kind = ANY (ARRAY['link'::text, 'email'::text]))),
  CONSTRAINT "admin_contacts_label_check" CHECK (((label = btrim(label)) AND ((char_length(label) >= 1) AND (char_length(label) <= 40)))),
  CONSTRAINT "admin_contacts_pkey" PRIMARY KEY ("position"),
  CONSTRAINT "admin_contacts_position_check" CHECK ((("position" >= 0) AND ("position" <= 9))),
  CONSTRAINT "admin_contacts_value_check" CHECK (
CASE kind
    WHEN 'link'::text THEN ((char_length(value) <= 500) AND (value ~ '^https://[^[:space:]]+$'::text))
    WHEN 'email'::text THEN ((char_length(value) <= 254) AND (value ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'::text))
    ELSE false
END)
);

ALTER TABLE "public"."admin_contacts"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.admin_replace_contacts (
  p_contacts jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_app_admin();

  if p_contacts is null or jsonb_typeof(p_contacts) <> 'array' then
    raise exception 'contacts must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_contacts) > 10 then
    raise exception 'too many contacts' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('admin-contacts-replace', 0));

  delete from public.admin_contacts where true;

  insert into public.admin_contacts (position, kind, label, value)
  select
    (item.ordinality - 1)::smallint,
    item.contact ->> 'kind',
    btrim(item.contact ->> 'label'),
    btrim(item.contact ->> 'value')
  from jsonb_array_elements(p_contacts) with ordinality as item(contact, ordinality);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."admin_replace_contacts"(jsonb) FROM PUBLIC, "anon", "service_role";

CREATE POLICY "admin_contacts_select_public" ON "public"."admin_contacts"
  FOR SELECT
  TO "anon", "authenticated"
  USING (true);

GRANT EXECUTE ON FUNCTION "public"."admin_replace_contacts"(jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_replace_contacts"(jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_replace_contacts"(jsonb) TO "postgres";

REVOKE ALL ON TABLE "public"."admin_contacts" FROM "anon";

GRANT SELECT ON TABLE "public"."admin_contacts" TO "anon";

REVOKE ALL ON TABLE "public"."admin_contacts" FROM "authenticated";

GRANT SELECT ON TABLE "public"."admin_contacts" TO "authenticated";

REVOKE ALL ON TABLE "public"."admin_contacts" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_contacts" TO "postgres";

REVOKE ALL ON TABLE "public"."admin_contacts" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."admin_contacts" TO "service_role";
