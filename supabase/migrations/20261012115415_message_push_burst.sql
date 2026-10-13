SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.message_delivery_allowed (
  p_delivery private.notification_delivery_outbox
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from private.messages as message
    join private.web_push_subscriptions as subscription
      on subscription.id = p_delivery.subscription_id
      and subscription.profile_id = p_delivery.recipient_profile_id
      and subscription.gone_at is null
      and (subscription.expiration_time is null or subscription.expiration_time > now())
    join public.conversation_members as member
      on member.conversation_id = message.conversation_id
      and member.profile_id = p_delivery.recipient_profile_id
      and member.left_at is null
      and message.sent_at >= member.joined_at
    where message.id = p_delivery.message_id
      and message.deleted_at is null
      and (member.muted_until is null or member.muted_until <= now())
      and (member.last_read_sent_at, member.last_read_message_id) < (message.sent_at, message.id)
      and (
        not exists (
          select 1
          from private.notification_delivery_outbox as newer
          join private.messages as newer_message on newer_message.id = newer.message_id
          where newer.subscription_id = p_delivery.subscription_id
            and newer.id <> p_delivery.id
            and newer.status in ('pending', 'leased')
            and newer_message.conversation_id = message.conversation_id
            and (newer_message.sent_at, newer_message.id) > (message.sent_at, message.id)
        )
        or exists (
          select 1
          from private.notification_delivery_outbox as skipped
          join private.messages as skipped_message on skipped_message.id = skipped.message_id
          where skipped.subscription_id = p_delivery.subscription_id
            and skipped.status = 'suppressed'
            and skipped_message.conversation_id = message.conversation_id
            and skipped_message.deleted_at is null
            and skipped_message.sent_at <= now() - interval '10 seconds'
            and (member.last_read_sent_at, member.last_read_message_id)
              < (skipped_message.sent_at, skipped_message.id)
            and skipped_message.sent_at > coalesce(
              (
                select max(sent_message.sent_at)
                from private.notification_delivery_outbox as sent
                join private.messages as sent_message on sent_message.id = sent.message_id
                where sent.subscription_id = p_delivery.subscription_id
                  and sent.status = 'sent'
                  and sent_message.conversation_id = message.conversation_id
              ),
              '-infinity'
            )
        )
      )
  );
$function$;

CREATE INDEX notification_delivery_message_finished_idx ON private.notification_delivery_outbox USING btree (subscription_id, status)
  WHERE ((message_id IS NOT NULL) AND (status = ANY (ARRAY['sent'::private.notification_delivery_status, 'suppressed'::private.notification_delivery_status])));
