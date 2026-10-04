import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationPermissionCard } from "~/features/notifications/components/notification-permission-card";
import { renderRoute } from "../../../router";

const mocks = vi.hoisted(() => ({
  enableWebPush: vi.fn(),
  getPushSupport: vi.fn(),
}));

vi.mock("~/features/notifications/data/push", () => mocks);

describe("NotificationPermissionCard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.getPushSupport.mockResolvedValue({
      state: "available",
      permission: "default",
      subscribed: false,
    });
    mocks.enableWebPush.mockResolvedValue({
      state: "available",
      permission: "granted",
      subscribed: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("브라우저 권한을 요청하지 않고 알림함 안에 안내한다", async () => {
    renderRoute(() => <NotificationPermissionCard profileId={42} />);

    expect(
      await screen.findByText("중요한 소식을 기기에서도 받아보세요"),
    ).toBeInTheDocument();
    expect(mocks.enableWebPush).not.toHaveBeenCalled();
  });

  it("알림 받기를 선택한 뒤에만 Web Push를 켠다", async () => {
    const { user } = renderRoute(() => (
      <NotificationPermissionCard profileId={42} />
    ));

    await user.click(await screen.findByRole("button", { name: "알림 받기" }));

    expect(mocks.enableWebPush).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(
        screen.queryByText("중요한 소식을 기기에서도 받아보세요"),
      ).not.toBeInTheDocument(),
    );
  });

  it("닫은 계정에는 다시 표시하지 않는다", async () => {
    const view = renderRoute(() => (
      <NotificationPermissionCard profileId={42} />
    ));

    await view.user.click(await screen.findByRole("button", { name: "닫기" }));
    view.unmount();

    renderRoute(() => <NotificationPermissionCard profileId={42} />);

    await waitFor(() => expect(mocks.getPushSupport).toHaveBeenCalledOnce());
    expect(
      screen.queryByText("중요한 소식을 기기에서도 받아보세요"),
    ).not.toBeInTheDocument();
  });
});
