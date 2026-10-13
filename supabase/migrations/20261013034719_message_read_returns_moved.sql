SET local check_function_bodies = off;

DROP FUNCTION "public"."mark_conversation_read"(uuid, uuid);

CREATE OR REPLACE FUNCTION public.mark_conversation_read (
  p_conversation_id uuid,
  p_message_id      uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  update public.conversation_members as member
  set last_read_sent_at = target.sent_at,
    last_read_message_id = target.id
  from private.messages as target
  where target.id = p_message_id
    and target.conversation_id = p_conversation_id
    and member.conversation_id = p_conversation_id
    and member.profile_id = caller_profile_id
    and member.left_at is null
    and target.sent_at >= member.joined_at
    and (member.last_read_sent_at, member.last_read_message_id) < (target.sent_at, target.id);
  return found;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."mark_conversation_read"(uuid, uuid) FROM PUBLIC, "anon", "service_role";

GRANT EXECUTE ON FUNCTION "public"."mark_conversation_read"(uuid, uuid) TO "authenticated";
