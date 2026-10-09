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

  /**
   * 회귀: 권한을 허용한 기기인데도 서버 구독 확인이 "아니오"로 오면 카드가 떴다. 앱을 열 때 빠진
   * 서버 기록을 다시 등록하는 동안이나 확인 요청이 실패한 경우다. 설정의 스위치는 켜져 있는데 안내가 떴다.
   */
  it("권한을 이미 허용한 기기에는 서버 구독 확인과 관계없이 띄우지 않는다", async () => {
    mocks.getPushSupport.mockResolvedValue({
      state: "available",
      permission: "granted",
      subscribed: false,
    });

    renderRoute(() => <NotificationPermissionCard profileId={42} />);

    await waitFor(() => expect(mocks.getPushSupport).toHaveBeenCalledOnce());
    expect(
      screen.queryByText("중요한 소식을 기기에서도 받아보세요"),
    ).not.toBeInTheDocument();
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
