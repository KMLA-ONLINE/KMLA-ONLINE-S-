-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.

-- 예약 작업 전부. pg-delta는 cron 작업을 스키마 객체로 비교하므로, 여기 없는 작업은 마이그레이션
-- 생성 때 지우는 문장(`cron.unschedule`)으로 나타난다. 호출하는 함수는 각 도메인 파일에 있고,
-- 파일이 이름순으로 실행되므로 이 파일은 그 함수들 뒤에 온다.

SELECT cron.schedule('cleanup-expired-feed-sessions-hourly', '23 * * * *', 'select private.cleanup_expired_feed_sessions()');

SELECT cron.schedule('cleanup-expired-records-daily', '13 4 * * *', 'select private.cleanup_expired_records()');

SELECT cron.schedule('cleanup-notifications-daily', '23 4 * * *', 'select private.cleanup_expired_notifications()');

SELECT cron.schedule('dispatch-notifications-every-30-seconds', '30 seconds', 'select private.invoke_notification_dispatcher()');

SELECT cron.schedule('drain-storage-cleanup-hourly', '47 * * * *', 'select private.invoke_storage_cleanup()');

SELECT cron.schedule('enqueue-storage-cleanup-daily', '17 3 * * *', 'select private.enqueue_storage_cleanup()');

SELECT cron.schedule('reconcile-storage-cleanup-runs', '*/5 * * * *', 'select private.reconcile_storage_cleanup_runs()');

SELECT cron.schedule('sweep-unreferenced-storage-weekly', '41 4 * * 0', 'select private.sweep_unreferenced_storage_objects(p_dry_run => false)');

