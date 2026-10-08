import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PwaPrompts } from "~/shared/components/pwa-prompts";

const serviceWorker = vi.hoisted(() => ({
  state: {
    updateActivated: false,
    updateChecksRunning: true,
    checkForUpdateNow: vi.fn(),
  },
}));

vi.mock("~/shared/hooks/use-service-worker", () => ({
  useServiceWorker: () => serviceWorker.state,
}));
vi.mock("~/shared/hooks/use-reload-on-navigation", () => ({
  useReloadOnNavigation: () => ({ current: null }),
}));
vi.mock("~/shared/components/install-prompt", () => ({
  InstallPrompt: () => null,
}));

describe("PwaPrompts", () => {
  afterEach(() => {
    serviceWorker.state.updateActivated = false;
    serviceWorker.state.updateChecksRunning = true;
    vi.clearAllMocks();
  });

  it("지원이 끝난 버전이면 화면을 막고 새 빌드를 기다리며 확인한다", () => {
    render(<PwaPrompts updateRequired />);

    expect(
      screen.getByRole("alertdialog", { name: "업데이트가 필요합니다" }),
    ).toBeInTheDocument();
    expect(serviceWorker.state.checkForUpdateNow).toHaveBeenCalledOnce();
  });

  it("막는 동안 뒤의 앱은 손이 닿지 않는다", () => {
    const { container, unmount } = render(<PwaPrompts updateRequired />);

    expect(container.inert).toBe(true);
    unmount();
    expect(container.inert).toBe(false);
  });

  it("새 빌드를 기다려 줄 서비스 워커가 없으면 새로고침을 권한다", () => {
    serviceWorker.state.updateChecksRunning = false;

    render(<PwaPrompts updateRequired />);

    expect(
      screen.getByText(
        "지금 버전은 더 이상 쓸 수 없습니다. 새로고침해서 새 버전을 받아 주세요.",
      ),
    ).toBeInTheDocument();
  });

  it("평소에는 업데이트 안내를 띄우지 않는다", () => {
    serviceWorker.state.updateActivated = true;

    render(<PwaPrompts />);

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
