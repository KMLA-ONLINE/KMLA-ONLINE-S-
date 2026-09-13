import { describe, expect, it } from "vitest";

import { StorageCleanupScreen } from "~/features/admin/components/storage-cleanup-screen";
import type { StorageCleanupStatus } from "~/features/admin/model/types";
import { renderRoute, screen } from "../../../router";

const status: StorageCleanupStatus = {
  last_cron_at: "2026-09-13T03:47:00.000Z",
  last_cron_status: "succeeded",
  last_run_error: "storage unavailable",
  last_run_failed: 0,
  last_run_finished_at: "2026-09-13T03:47:02.000Z",
  last_run_removed: 4,
  last_run_started_at: "2026-09-13T03:47:00.000Z",
  last_run_status_code: 200,
  queue_dry_run: 0,
  queue_oldest_enqueued_at: "2026-09-13T02:00:00.000Z",
  queue_pending: 0,
  queue_retrying: 0,
  secrets_configured: true,
};

describe("StorageCleanupScreen", () => {
  it("offers a status refresh without providing a cleanup action", async () => {
    const { user } = renderRoute(() => (
      <StorageCleanupScreen status={status} />
    ));

    await user.click(screen.getByRole("button", { name: "상태 새로고침" }));

    expect(
      screen.queryByRole("button", { name: /정리 실행/ }),
    ).not.toBeInTheDocument();
  });
});
