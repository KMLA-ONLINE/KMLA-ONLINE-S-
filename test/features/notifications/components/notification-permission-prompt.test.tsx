import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationPermissionPrompt } from "~/features/notifications/components/notification-permission-prompt";
import { setPromptActive } from "~/shared/lib/prompt-coordinator";
import { renderRoute } from "../../../router";

const mocks = vi.hoisted(() => ({
  enableWebPush: vi.fn(),
  getPushSupport: vi.fn(),
}));

vi.mock("~/features/notifications/data/push", () => mocks);

describe("NotificationPermissionPrompt", () => {
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
    setPromptActive("service-worker", false);
    vi.clearAllMocks();
  });

  it("브라우저 권한을 요청하기 전에 자체 안내 창을 띄운다", async () => {
    renderRoute(() => <NotificationPermissionPrompt profileId={42} />);

    expect(await screen.findByText("알림을 켜시겠어요?")).toBeInTheDocument();
    expect(mocks.enableWebPush).not.toHaveBeenCalled();
  });

  it("알림 받기를 선택한 뒤에만 Web Push를 켠다", async () => {
    const { user } = renderRoute(() => (
      <NotificationPermissionPrompt profileId={42} />
    ));

    await user.click(await screen.findByRole("button", { name: "알림 받기" }));

    expect(mocks.enableWebPush).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByText("알림을 켜시겠어요?")).not.toBeInTheDocument(),
    );
  });

  /**
   * 회귀: 권한을 허용한 기기인데도 서버 구독 확인이 "아니오"로 오면 안내가 떴다. 앱을 열 때 빠진
   * 서버 기록을 다시 등록하는 동안이나 확인 요청이 실패한 경우다. 설정의 스위치는 켜져 있는데 안내가 떴다.
   */
  it("권한을 이미 허용한 기기에는 서버 구독 확인과 관계없이 띄우지 않는다", async () => {
    mocks.getPushSupport.mockResolvedValue({
      state: "available",
      permission: "granted",
      subscribed: false,
    });

    renderRoute(() => <NotificationPermissionPrompt profileId={42} />);

    await waitFor(() => expect(mocks.getPushSupport).toHaveBeenCalledOnce());
    expect(screen.queryByText("알림을 켜시겠어요?")).not.toBeInTheDocument();
  });

  it("다른 안내가 떠 있는 동안 미뤘다가 사라지면 띄운다", async () => {
    setPromptActive("service-worker", true);
    renderRoute(() => <NotificationPermissionPrompt profileId={42} />);

    await waitFor(() => expect(mocks.getPushSupport).toHaveBeenCalledOnce());
    expect(screen.queryByText("알림을 켜시겠어요?")).not.toBeInTheDocument();

    act(() => setPromptActive("service-worker", false));
    expect(await screen.findByText("알림을 켜시겠어요?")).toBeInTheDocument();
  });

  it("닫은 계정에는 다시 표시하지 않는다", async () => {
    const view = renderRoute(() => (
      <NotificationPermissionPrompt profileId={42} />
    ));

    await view.user.click(
      await screen.findByRole("button", { name: "나중에" }),
    );
    view.unmount();

    renderRoute(() => <NotificationPermissionPrompt profileId={42} />);

    await waitFor(() => expect(mocks.getPushSupport).toHaveBeenCalledOnce());
    expect(screen.queryByText("알림을 켜시겠어요?")).not.toBeInTheDocument();
  });

  describe("in English", () => {
    beforeEach(() => {
      window.localStorage.setItem("kmla-online:language:v1", "en");
    });
    afterEach(() => {
      window.localStorage.clear();
    });

    it("renders the prompt in English", async () => {
      renderRoute(() => <NotificationPermissionPrompt profileId={42} />);

      expect(
        await screen.findByText("Turn on notifications?"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Turn on notifications" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Later" })).toBeInTheDocument();
    });
  });
});
