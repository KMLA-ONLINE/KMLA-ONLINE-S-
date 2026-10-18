import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useUnreadCounts: vi.fn(),
  setAppBadgeCount: vi.fn(),
  setTabBadgeCount: vi.fn(),
}));

vi.mock("~/features/app-shell/context/app-shell-context", () => ({
  useUnreadCounts: mocks.useUnreadCounts,
}));
vi.mock("~/shared/lib/app-badge", () => ({
  setAppBadgeCount: mocks.setAppBadgeCount,
}));
vi.mock("~/shared/lib/tab-badge", () => ({
  setTabBadgeCount: mocks.setTabBadgeCount,
}));

import { UnreadBadgeSync } from "~/features/app-shell/components/unread-badge-sync";

// 앞 테스트가 자동 정리로 내려가며 부른 `setTabBadgeCount(0)`이 남지 않도록 시작할 때 비운다.
beforeEach(() => {
  vi.clearAllMocks();
});

describe("UnreadBadgeSync", () => {
  it("mirrors the unread notification and message total onto the app icon and tab", () => {
    mocks.useUnreadCounts.mockReturnValue({
      notifications: 3,
      messages: 2,
      pending: false,
    });

    render(<UnreadBadgeSync />);

    expect(mocks.setAppBadgeCount).toHaveBeenCalledWith(5);
    expect(mocks.setTabBadgeCount).toHaveBeenCalledWith(5);
  });

  it("keeps the previous badges until both counts have loaded", () => {
    mocks.useUnreadCounts.mockReturnValue({
      notifications: 3,
      messages: 0,
      pending: true,
    });

    render(<UnreadBadgeSync />);

    expect(mocks.setAppBadgeCount).not.toHaveBeenCalled();
    expect(mocks.setTabBadgeCount).not.toHaveBeenCalled();
  });

  it("clears the tab badge when the shell unmounts", () => {
    mocks.useUnreadCounts.mockReturnValue({
      notifications: 1,
      messages: 0,
      pending: false,
    });

    const view = render(<UnreadBadgeSync />);
    view.unmount();

    expect(mocks.setTabBadgeCount).toHaveBeenLastCalledWith(0);
  });
});
