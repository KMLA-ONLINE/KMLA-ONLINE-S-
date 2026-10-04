-- Migration unit 1: cron_and_dml
-- Transaction mode: transactional
-- Boundary reason: cron registration and queue DML are not represented by schema diff

-- 2층 스윕을 실제 삭제로 전환한다. `20260901011134_rebuild_storage_cleanup`이 dry-run으로
-- 등록했고, dev와 prod 양쪽에서 후보 목록에 살아 있는 object가 섞이지 않는 것을 확인했다.

select cron.unschedule(jobid)
from cron.job
where jobname = 'sweep-unreferenced-storage-weekly';

select cron.schedule(
  'sweep-unreferenced-storage-weekly',
  '41 4 * * 0',
  'select private.sweep_unreferenced_storage_objects(p_dry_run => false)'
);

-- 이미 기록해 둔 후보를 승격시킨다. 이 문장이 없으면 dry-run 기간에 쌓인 행은 계속 dry_run으로
-- 남아 워커가 영영 가져가지 않는다. `next_attempt_at`을 당겨 다음 드레인이 바로 집어 가게 한다.
update private.storage_cleanup_queue
set dry_run = false,
  next_attempt_at = now()
where reason = 'unreferenced_sweep'
  and dry_run;

-- `private.sweep_unreferenced_storage_objects()`의 기본값은 `p_dry_run => true`로 남겨 둔다.
-- 예약 실행은 위에서 인자를 명시하므로 영향이 없고, 사람이 손으로 부를 때는 지우지 않는 쪽이
-- 기본이어야 한다.
