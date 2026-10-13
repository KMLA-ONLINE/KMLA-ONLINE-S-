SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.broadcast_read_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if coalesce(current_setting('messaging.suppress_signals', true) = 'on', false) then
    return null;
  end if;
  perform realtime.send(
    jsonb_build_object(
      'conversation_id', new.conversation_id,
      'profile_id', new.profile_id
    ),
    'read_changed',
    'messaging-room:' || new.conversation_id::text,
    true
  );
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.can_receive_room_signals (
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
    where member.profile_id = private.current_profile_id()
      and member.left_at is null
      and 'messaging-room:' || member.conversation_id::text = p_topic
  );
$function$;

CREATE POLICY "messaging_room_signals_receive_member" ON "realtime"."messages"
  FOR SELECT
  TO "authenticated"
  USING (((EXTENSION = 'broadcast'::text) AND ( SELECT private.can_receive_room_signals(( SELECT realtime.topic() AS topic)) AS can_receive_room_signals)));

REVOKE ALL ON FUNCTION "private"."can_receive_room_signals"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."can_receive_room_signals"(text) TO "authenticated";
