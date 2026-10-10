SET local check_function_bodies = off;

DROP FUNCTION "public"."get_my_web_push_status"(text);

DROP FUNCTION "public"."register_my_web_push_subscription"(text, text, text, double precision);

ALTER TABLE "private"."web_push_subscriptions"
  ADD COLUMN "gone_at" timestamp WITH time zone;

CREATE OR REPLACE FUNCTION private.cleanup_expired_notifications()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  removed bigint;
begin
  delete from public.notifications
  where last_activity_at < now() - interval '30 days';
  get diagnostics removed = row_count;
  delete from private.notification_event_keys
  where notification_id is null and created_at < now() - interval '30 days';
  delete from private.web_push_subscriptions
  where gone_at < now() - interval '30 days';
  return removed;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_notification_push (
  p_notification_id uuid
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  target public.notifications;
  inserted_count integer;
begin
  select notification.* into target
  from public.notifications as notification
  where notification.id = p_notification_id;

  if target.id is null then
    return 0;
  end if;

  insert into private.notification_delivery_outbox (
    notification_id, recipient_profile_id, subscription_id, channel
  )
  select target.id, target.recipient_profile_id, subscription.id, 'web_push'
  from private.web_push_subscriptions as subscription
  where subscription.profile_id = target.recipient_profile_id
    and subscription.gone_at is null
    and private.notification_push_allowed(
      target, subscription.created_at, subscription.expiration_time
    )
  on conflict do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$function$;

CREATE OR REPLACE FUNCTION private.notification_delivery_allowed (
  p_delivery private.notification_delivery_outbox
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select p_delivery.channel = 'email'
    or exists (
      select 1
      from public.notifications as notification
      join private.web_push_subscriptions as subscription
        on subscription.id = p_delivery.subscription_id
      where notification.id = p_delivery.notification_id
        and subscription.profile_id = p_delivery.recipient_profile_id
        and subscription.gone_at is null
        and private.notification_push_allowed(
          notification, subscription.created_at, subscription.expiration_time
        )
        and (
          notification.category = 'moderation'
          or notification.kind in (
            'group_deleted', 'group_join_rejected',
            'account_approved', 'account_blocked', 'account_unblocked'
          )
          or (
            notification.post_id is not null
            and exists (
              select 1
              from public.posts as post
              where post.id = notification.post_id
                and (
                  (post.kind = 'group' and exists (
                    select 1 from public.group_memberships as membership
                    where membership.group_id = post.group_id
                      and membership.profile_id = p_delivery.recipient_profile_id
                  ))
                  or (post.kind = 'profile' and post.visibility = 'public')
                )
            )
          )
          or (
            notification.post_id is null
            and notification.group_id is not null
            and exists (
              select 1 from public.group_memberships as membership
              join public.groups as group_record on group_record.id = membership.group_id
              where membership.group_id = notification.group_id
                and membership.profile_id = p_delivery.recipient_profile_id
            )
          )
          or (notification.post_id is null and notification.group_id is null)
        )
    );
$function$;

CREATE OR REPLACE FUNCTION public.complete_notification_delivery (
  p_delivery_id uuid,
  p_lease_id    uuid,
  p_outcome     text,
  p_status_code integer DEFAULT NULL::integer,
  p_error_code  text    DEFAULT NULL::text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  target private.notification_delivery_outbox;
begin
  if p_outcome not in ('sent', 'suppressed', 'retry', 'dead', 'gone') then
    raise exception 'invalid notification delivery outcome' using errcode = '22023';
  end if;
  select delivery.* into target
  from private.notification_delivery_outbox as delivery
  where delivery.id = p_delivery_id and delivery.status = 'leased'
    and delivery.lease_id = p_lease_id
  for update;
  if target.id is null then return false; end if;

  insert into private.notification_delivery_attempts (
    delivery_id, outcome, status_code, error_code
  ) values (target.id, p_outcome, p_status_code, left(p_error_code, 80));

  if p_outcome = 'gone' then
    update private.web_push_subscriptions
    set gone_at = coalesce(gone_at, now())
    where id = target.subscription_id;
  end if;

  if p_outcome = 'retry' and target.attempt_count < 5 then
    update private.notification_delivery_outbox
    set status = 'pending', lease_id = null, lease_expires_at = null,
      available_at = now() + make_interval(secs => least(3600, 15 * (2 ^ target.attempt_count)::integer)),
      last_status_code = p_status_code, last_error_code = left(p_error_code, 80)
    where id = target.id;
  else
    update private.notification_delivery_outbox
    set status = case
        when p_outcome = 'sent' then 'sent'::private.notification_delivery_status
        when p_outcome = 'suppressed' then 'suppressed'::private.notification_delivery_status
        else 'dead'::private.notification_delivery_status
      end,
      lease_id = null, lease_expires_at = null, completed_at = now(),
      last_status_code = p_status_code, last_error_code = left(p_error_code, 80)
    where id = target.id;
  end if;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_web_push_status (
  p_endpoint text
)
  RETURNS TABLE (
    subscribed boolean,
    gone       boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  return query
  select coalesce(bool_or(subscription.gone_at is null), false),
    coalesce(bool_or(subscription.gone_at is not null), false)
  from private.web_push_subscriptions as subscription
  where subscription.endpoint = p_endpoint
    and subscription.profile_id = private.current_profile_id();
end;
$function$;

REVOKE ALL ON FUNCTION "public"."get_my_web_push_status"(text) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.register_my_web_push_subscription (
  p_endpoint        text,
  p_p256dh          text,
  p_auth            text,
  p_expiration_time double precision DEFAULT NULL::double precision
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  live boolean;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_endpoint !~ '^https://[^[:space:]]+$'
    or p_p256dh !~ '^[A-Za-z0-9_-]+$'
    or p_auth !~ '^[A-Za-z0-9_-]+$'
    or p_expiration_time < 0
    or p_expiration_time > 253402300799999 then
    raise exception 'invalid web push subscription' using errcode = '22023';
  end if;
  -- 같은 키로 다시 올라온 gone endpoint는 브라우저가 들고 있던 죽은 구독이라 살리지 않는다.
  -- 그래야 클라이언트가 `gone`을 보고 새로 구독한다. 새 구독은 키가 반드시 바뀌므로, endpoint가
  -- 우연히 같아도 키가 다르면 살린다.
  insert into private.web_push_subscriptions as subscription (
    profile_id, endpoint, p256dh, auth, expiration_time
  ) values (
    caller_profile_id, p_endpoint, p_p256dh, p_auth,
    case when p_expiration_time is null
      then null
      else to_timestamp(p_expiration_time / 1000.0)
    end
  ) on conflict (endpoint) do update set
    profile_id = excluded.profile_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    expiration_time = excluded.expiration_time,
    gone_at = case
      when subscription.p256dh = excluded.p256dh
        and subscription.auth = excluded.auth
        then subscription.gone_at
    end,
    updated_at = now()
  returning subscription.gone_at is null into live;
  -- false면 클라이언트는 새로 구독해 다시 올린다. 상태를 따로 읽다 실패하거나, 다른 계정이 쓰던
  -- gone endpoint를 넘겨받은 경우에도 이 답 하나로 걸러진다.
  return live;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."register_my_web_push_subscription"(text, text, text, double precision) FROM PUBLIC, "anon", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_my_web_push_status"(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."register_my_web_push_subscription"(text, text, text, double precision) TO "authenticated";
