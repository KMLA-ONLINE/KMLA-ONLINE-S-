-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.claim_notification_deliveries(IN p_limit integer, IN p_lease_seconds integer);

CREATE FUNCTION public.claim_notification_deliveries (
  p_limit         integer DEFAULT 50,
  p_lease_seconds integer DEFAULT 120
)
  RETURNS TABLE (
    delivery_id     uuid,
    lease_id        uuid,
    channel         private.notification_delivery_channel,
    endpoint        text,
    p256dh          text,
    auth            text,
    recipient_email text,
    notification_id uuid,
    importance      public.notification_importance,
    category        public.notification_category,
    grouping_key    uuid,
    title           text,
    body            text,
    tag             text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if p_limit not between 1 and 200 or p_lease_seconds not between 30 and 600 then
    raise exception 'invalid notification lease parameters' using errcode = '22023';
  end if;
  update private.notification_delivery_outbox as delivery
  set status = 'suppressed', completed_at = now(),
    lease_id = null, lease_expires_at = null,
    last_error_code = 'no_longer_deliverable'
  where delivery.channel = 'web_push'
    and (
      delivery.status = 'pending'
      or (delivery.status = 'leased' and delivery.lease_expires_at <= now())
    )
    and delivery.available_at <= now()
    and not private.notification_delivery_allowed(delivery);
  update private.notification_delivery_outbox as delivery
  set status = 'dead', completed_at = now(),
    lease_id = null, lease_expires_at = null,
    last_error_code = 'attempts_exhausted'
  where (
      delivery.status = 'pending'
      or (delivery.status = 'leased' and delivery.lease_expires_at <= now())
    )
    and delivery.available_at <= now()
    and delivery.attempt_count >= 10;

  return query
  with candidates as (
    select delivery.id
    from private.notification_delivery_outbox as delivery
    where (
        delivery.status = 'pending'
        or (delivery.status = 'leased' and delivery.lease_expires_at <= now())
      )
      and delivery.available_at <= now()
      and delivery.attempt_count < 10
    order by delivery.available_at, delivery.created_at, delivery.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update private.notification_delivery_outbox as delivery
    set status = 'leased', lease_id = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt_count = delivery.attempt_count + 1
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select claimed.id, claimed.lease_id, claimed.channel,
    subscription.endpoint, subscription.p256dh, subscription.auth,
    claimed.recipient_email, notification.id,
    notification.importance, notification.category,
    subscription.id,
    notification.title,
    case notification.kind
      when 'post_commented' then '내 게시물에 새 댓글이 등록되었습니다.'
      when 'comment_replied' then '내 댓글에 새 답글이 등록되었습니다.'
      when 'group_posted' then '그룹에 새 게시물이 등록되었습니다.'
      when 'account_approved' then '가입이 승인되었습니다.'
      when 'account_blocked' then '가입이 차단되었습니다.'
      when 'account_unblocked' then '차단이 해제되었습니다.'
      when 'anonymous_activity_restricted' then '그룹 익명 활동이 제한되었습니다.'
      else '새 알림이 있습니다.'
    end,
    case
      when notification.importance = 'high'
        then 'notification:' || notification.id::text
      else 'notification-category:' || notification.category::text || ':' || subscription.id::text
    end
  from claimed
  left join private.web_push_subscriptions as subscription
    on subscription.id = claimed.subscription_id
  left join public.notifications as notification
    on notification.id = claimed.notification_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.claim_notification_deliveries(integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.claim_notification_deliveries(integer, integer) TO service_role;
