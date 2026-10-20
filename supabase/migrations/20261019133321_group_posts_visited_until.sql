SET local check_function_bodies = off;

DROP FUNCTION "public"."mark_group_posts_visited"(uuid);

CREATE OR REPLACE FUNCTION public.mark_group_posts_visited (
  p_group_id   uuid,
  p_seen_until timestamp with time zone DEFAULT NULL::timestamp WITH time zone
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  update public.group_memberships
  set posts_visited_at = greatest(
    posts_visited_at,
    least(coalesce(p_seen_until, statement_timestamp()), statement_timestamp())
  )
  where group_id = p_group_id and profile_id = caller_id;
  if not found then
    raise exception 'group membership required' using errcode = '42501';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."mark_group_posts_visited"(uuid, timestamp WITH time zone) FROM PUBLIC, "anon", "service_role";

GRANT EXECUTE ON FUNCTION "public"."mark_group_posts_visited"(uuid, timestamp WITH time zone) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."mark_group_posts_visited"(uuid, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."mark_group_posts_visited"(uuid, timestamp WITH time zone) TO "postgres";
