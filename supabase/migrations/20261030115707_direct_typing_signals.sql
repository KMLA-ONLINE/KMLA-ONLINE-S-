SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.can_use_typing_signals (
  p_topic text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.conversation_members as member
    join public.conversations as conversation on conversation.id = member.conversation_id
    where member.profile_id = private.current_profile_id()
      and member.left_at is null
      and conversation.type = 'direct'
      and 'messaging-typing:' || member.conversation_id::text = p_topic
  );
$function$;

CREATE POLICY "messaging_typing_signals_receive_member" ON "realtime"."messages"
  FOR SELECT
  TO "authenticated"
  USING (((EXTENSION = 'broadcast'::text) AND ( SELECT private.can_use_typing_signals(( SELECT realtime.topic() AS topic)) AS can_use_typing_signals)));

CREATE POLICY "messaging_typing_signals_send_member" ON "realtime"."messages"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((extension = 'broadcast'::text) AND ( SELECT private.can_use_typing_signals(( SELECT realtime.topic() AS topic)) AS can_use_typing_signals)));

REVOKE ALL ON FUNCTION "private"."can_use_typing_signals"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."can_use_typing_signals"(text) TO "authenticated";
