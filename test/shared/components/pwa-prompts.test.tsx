import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PwaPrompts } from "~/shared/components/pwa-prompts";

const serviceWorker = vi.hoisted(() => ({
  state: {
    updateActivated: false,
    checkForUpdateNow: vi.fn(),
  },
}));

vi.mock("~/shared/hooks/use-service-worker", () => ({
  useServiceWorker: () => serviceWorker.state,
}));
vi.mock("~/shared/hooks/use-reload-on-navigation", () => ({
  useReloadOnNavigation: () => undefined,
}));
vi.mock("~/shared/components/install-prompt", () => ({
  InstallPrompt: () => null,
}));

describe("PwaPrompts", () => {
  afterEach(() => {
    serviceWorker.state.updateActivated = false;
    vi.clearAllMocks();
  });

  it("지원이 끝난 버전이면 화면을 막고 새 빌드를 기다리며 확인한다", () => {
    render(<PwaPrompts updateRequired />);

    expect(
      screen.getByRole("alertdialog", { name: "업데이트가 필요합니다" }),
    ).toBeInTheDocument();
    expect(serviceWorker.state.checkForUpdateNow).toHaveBeenCalledOnce();
  });

  it("평소에는 업데이트 안내를 띄우지 않는다", () => {
    serviceWorker.state.updateActivated = true;

    render(<PwaPrompts />);

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
