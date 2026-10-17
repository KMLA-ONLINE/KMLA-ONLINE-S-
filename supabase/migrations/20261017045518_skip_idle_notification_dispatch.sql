SET local check_function_bodies = off;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'dispatch-notifications-every-30-seconds';

CREATE OR REPLACE FUNCTION private.invoke_notification_dispatcher_if_due()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not exists (
    select 1
    from private.notification_delivery_outbox as delivery
    where (
        delivery.status = 'pending'
        or (delivery.status = 'leased' and delivery.lease_expires_at <= now())
      )
      and delivery.available_at <= now() + interval '5 seconds'
  ) then
    return null;
  end if;
  return private.invoke_notification_dispatcher();
end;
$function$;


REVOKE ALL ON FUNCTION "private"."invoke_notification_dispatcher_if_due"() FROM PUBLIC;

SELECT cron.schedule_in_database('dispatch-notifications-every-30-seconds', '30 seconds', 'select private.invoke_notification_dispatcher_if_due()', 'postgres', NULL, true);
