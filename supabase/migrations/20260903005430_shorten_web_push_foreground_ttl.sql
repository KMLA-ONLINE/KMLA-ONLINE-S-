-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.refresh_my_web_push_foreground (
  p_endpoint text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  update private.web_push_subscriptions
  set foreground_until = now() + interval '40 seconds'
  where endpoint = p_endpoint and profile_id = private.current_profile_id();
  return found;
end;
$function$;