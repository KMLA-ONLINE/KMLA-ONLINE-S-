import { describe, expect, it } from "vitest";

import { StorageCleanupScreen } from "~/features/admin/components/storage-cleanup-screen";
import type { StorageCleanupStatus } from "~/features/admin/model/types";
import { renderRoute, screen } from "../../../router";

/** 정리가 한 번도 돌지 않은 프로젝트. RPC의 `left join`이 두 묶음을 통째로 NULL로 돌려준다. */
const empty: StorageCleanupStatus = {
  secrets_configured: true,
  queue_pending: 0,
  queue_retrying: 0,
  queue_dry_run: 0,
  queue_oldest_enqueued_at: null,
  last_run_started_at: null,
  last_run_finished_at: null,
  last_run_status_code: null,
  last_run_removed: null,
  last_run_failed: null,
  last_run_error: null,
  last_cron_status: null,
  last_cron_at: null,
};

const healthy: StorageCleanupStatus = {
  ...empty,
  queue_oldest_enqueued_at: "2026-09-13T02:00:00.000Z",
  last_run_started_at: "2026-09-13T03:47:00.000Z",
  last_run_finished_at: "2026-09-13T03:47:02.000Z",
  last_run_status_code: 200,
  last_run_removed: 4,
  last_run_failed: 0,
  last_cron_status: "succeeded",
  last_cron_at: "2026-09-13T03:47:00.000Z",
};

describe("StorageCleanupScreen", () => {
  it("offers a status refresh without providing a cleanup action", async () => {
    const { user } = renderRoute(() => (
      <StorageCleanupScreen status={healthy} />
    ));

    await user.click(screen.getByRole("button", { name: "상태 새로고침" }));

    expect(
      screen.queryByRole("button", { name: /정리 실행/ }),
    ).not.toBeInTheDocument();
  });

  it("reports a load failure instead of rendering an empty dashboard", () => {
    renderRoute(() => <StorageCleanupScreen status={null} />);

    expect(screen.getByText(/불러오지 못했습니다/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "상태 새로고침" }),
    ).not.toBeInTheDocument();
  });

  it("leads with the stalled verdict when the vault secrets are missing", () => {
    renderRoute(() => (
      <StorageCleanupScreen
        status={{ ...healthy, secrets_configured: false }}
      />
    ));

    expect(screen.getByText("정리가 멈춰 있습니다")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Vault에 설정해 주세요/,
    );
  });

  it("counts a failing run as failed even when a status code is absent", () => {
    renderRoute(() => (
      <StorageCleanupScreen
        status={{
          ...healthy,
          last_run_status_code: null,
          last_run_error: "storage unavailable",
        }}
      />
    ));

    expect(screen.getByText("실패")).toBeInTheDocument();
    expect(screen.getByText("마지막 실행이 실패했습니다")).toBeInTheDocument();
  });

  // 요청은 200인데 개별 파일이 남은 실행. 예전 화면은 "성공" 배지 옆에 실패 건수를 세워 두었다.
  it("separates per-file failures from a successful request", () => {
    renderRoute(() => (
      <StorageCleanupScreen
        status={{ ...healthy, last_run_removed: 1, last_run_failed: 3 }}
      />
    ));

    expect(screen.getByText("부분 실패")).toBeInTheDocument();
    expect(screen.queryByText("성공")).not.toBeInTheDocument();
    expect(
      screen.getByText("일부 파일을 지우지 못했습니다"),
    ).toBeInTheDocument();
  });

  it("keeps an unfinished run out of the failed state", () => {
    renderRoute(() => (
      <StorageCleanupScreen
        status={{
          ...healthy,
          last_run_finished_at: null,
          last_run_status_code: null,
          last_run_removed: null,
          last_run_failed: null,
        }}
      />
    ));

    expect(screen.getByText("진행 중")).toBeInTheDocument();
    expect(screen.getByText("정리가 실행 중입니다")).toBeInTheDocument();
  });

  it("distinguishes a never-run worker with a backlog from an idle one", () => {
    const { unmount } = renderRoute(() => (
      <StorageCleanupScreen status={empty} />
    ));

    expect(screen.getByText("기록 없음")).toBeInTheDocument();
    expect(screen.getByText("지울 파일이 없습니다")).toBeInTheDocument();
    unmount();

    renderRoute(() => (
      <StorageCleanupScreen status={{ ...empty, queue_pending: 7 }} />
    ));

    expect(
      screen.getByText("아직 한 번도 실행되지 않았습니다"),
    ).toBeInTheDocument();
  });

  // `retrying`은 `pending`의 부분집합이다. 두 값을 형제로 읽으면 5 + 2 = 7건으로 오해한다.
  it("labels the retry count as a subset of the pending count", () => {
    renderRoute(() => (
      <StorageCleanupScreen
        status={{ ...healthy, queue_pending: 5, queue_retrying: 2 }}
      />
    ));

    expect(screen.getByText("그중 재시도")).toBeInTheDocument();
    expect(screen.getByText("재시도 포함")).toBeInTheDocument();
  });

  it("states the healthy verdict, and whether anything is still queued", () => {
    const { unmount } = renderRoute(() => (
      <StorageCleanupScreen status={healthy} />
    ));

    expect(screen.getByText("성공")).toBeInTheDocument();
    expect(screen.getByText("정상 동작 중입니다")).toBeInTheDocument();
    expect(screen.getByText(/대기 중인 파일이 없습니다/)).toBeInTheDocument();
    unmount();

    renderRoute(() => (
      <StorageCleanupScreen status={{ ...healthy, queue_pending: 3 }} />
    ));

    expect(screen.getByText("정상 동작 중입니다")).toBeInTheDocument();
    expect(
      screen.getByText(/3개가 다음 차례를 기다립니다/),
    ).toBeInTheDocument();
  });

  // 새로고침으로 판정이 뒤집히는 순간이 이 화면에서 가장 중요한 사건이다. 조용히 바뀌면 안 된다.
  it("announces the verdict through a live region", () => {
    renderRoute(() => <StorageCleanupScreen status={healthy} />);

    const live = screen.getByText("정상 동작 중입니다").closest("[aria-live]");

    expect(live).not.toBeNull();
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("대기 중인 파일이 없습니다");
  });

  it("says the removed count is files, and only from the last run", () => {
    renderRoute(() => <StorageCleanupScreen status={healthy} />);

    expect(screen.getByText("삭제한 파일")).toBeInTheDocument();
    expect(screen.getByText("이미 없던 파일 포함")).toBeInTheDocument();
    expect(screen.getByText(/최근 실행 한 번의 결과/)).toBeInTheDocument();
  });
});
