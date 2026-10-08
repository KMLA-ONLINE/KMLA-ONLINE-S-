SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.min_client_version()
  RETURNS integer
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select 1;
$function$;

REVOKE ALL ON FUNCTION "public"."min_client_version"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."min_client_version"() TO "anon", "authenticated", "postgres", "service_role";
