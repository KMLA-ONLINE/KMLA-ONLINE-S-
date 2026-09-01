-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION private.cleanup_group_join_request_notification()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  delete from public.notifications as notification
  where notification.id in (
    select event_key.notification_id
    from private.notification_event_keys as event_key
    where event_key.event_key like
      'group-join-request:' || old.id::text || ':recipient:%'
  );
  return old;
end;
$function$;

REVOKE ALL ON FUNCTION private.cleanup_group_join_request_notification() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.notification_push_allowed (
  p_notification                 public.notifications,
  p_subscription_created_at      timestamp with time zone,
  p_subscription_expiration_time timestamp with time zone
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select p_subscription_created_at <= p_notification.created_at
    and (
      p_subscription_expiration_time is null
      or p_subscription_expiration_time > now()
    )
    and p_notification.kind not in ('post_reacted', 'comment_reacted', 'application_submitted')
    and (
      p_notification.category = 'moderation'
      or p_notification.kind = 'group_posted'
      or case p_notification.category
        when 'content' then coalesce(preference.content_push_enabled, true)
        when 'timeline' then coalesce(preference.timeline_push_enabled, true)
        when 'group' then coalesce(preference.group_push_enabled, true)
        when 'account' then coalesce(preference.account_push_enabled, true)
        when 'school' then coalesce(preference.school_push_enabled, true)
        when 'moderation' then true
      end
    )
    and (
      p_notification.group_id is null
      or p_notification.category <> 'content'
      or exists (
        select 1
        from public.group_memberships as membership
        where membership.group_id = p_notification.group_id
          and membership.profile_id = p_notification.recipient_profile_id
          and membership.notification_level <> 'none'
          and membership.content_push_enabled
      )
    )
    and (
      p_notification.kind <> 'group_posted'
      or exists (
        select 1
        from public.group_memberships as membership
        where membership.group_id = p_notification.group_id
          and membership.profile_id = p_notification.recipient_profile_id
          and membership.notification_level = 'all'
          and membership.new_post_push_enabled
      )
    )
  from (select 1) as singleton
  left join public.notification_preferences as preference
    on preference.profile_id = p_notification.recipient_profile_id;
$function$;

CREATE TRIGGER group_join_requests_cleanup_notification
  AFTER DELETE ON public.group_join_requests
  FOR EACH ROW
  EXECUTE FUNCTION private.cleanup_group_join_request_notification();