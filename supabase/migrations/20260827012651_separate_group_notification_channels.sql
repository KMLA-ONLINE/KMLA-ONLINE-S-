-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.set_my_group_notification_preferences(p_group_id uuid, p_notification_level public.group_notification_level, p_new_post_push_enabled boolean);

ALTER TABLE public.group_memberships
  ADD COLUMN content_push_enabled boolean DEFAULT true NOT NULL;

UPDATE public.group_memberships
SET content_push_enabled = false
WHERE notification_level = 'none';

UPDATE public.group_memberships
SET new_post_push_enabled = false
WHERE notification_level <> 'all';

ALTER TABLE public.group_memberships
  ADD CONSTRAINT group_memberships_content_push_requires_in_app
  CHECK (NOT content_push_enabled OR notification_level <> 'none'::public.group_notification_level),
  ADD CONSTRAINT group_memberships_new_post_push_requires_all
  CHECK (NOT new_post_push_enabled OR notification_level = 'all'::public.group_notification_level);

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

CREATE FUNCTION public.set_my_group_notification_preferences (
  p_group_id              uuid,
  p_notification_level    public.group_notification_level,
  p_content_push_enabled  boolean,
  p_new_post_push_enabled boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_notification_level is null
    or p_content_push_enabled is null
    or p_new_post_push_enabled is null then
    raise exception 'group notification preferences must not be null' using errcode = '22023';
  end if;
  update public.group_memberships
  set notification_level = p_notification_level,
    content_push_enabled = p_notification_level <> 'none' and p_content_push_enabled,
    new_post_push_enabled = p_notification_level = 'all' and p_new_post_push_enabled
  where group_id = p_group_id and profile_id = private.current_profile_id();
  if not found then
    raise exception 'group membership required' using errcode = '42501';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.set_my_group_notification_preferences(uuid, public.group_notification_level, boolean, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_my_group_notification_preferences(uuid, public.group_notification_level, boolean, boolean) TO authenticated;
