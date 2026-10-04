-- Migration unit 1: data_changes
-- Transaction mode: transactional
-- Boundary reason: cron schedule changes are DML that schema diff cannot capture

select cron.unschedule(jobid)
from cron.job
where jobname = 'dispatch-notifications-every-30-seconds';

select cron.schedule(
  'dispatch-notifications-every-30-seconds',
  '30 seconds',
  'select private.invoke_notification_dispatcher()'
);
