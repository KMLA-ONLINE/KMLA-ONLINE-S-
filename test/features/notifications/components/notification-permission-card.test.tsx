import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationPermissionCard } from "~/features/notifications/components/notification-permission-card";
import { recordNotificationPromptHandled } from "~/features/notifications/model/prompt-storage";
import { renderRoute } from "../../../router";

const mocks = vi.hoisted(() => ({
  enableWebPush: vi.fn(),
  getPushSupport: vi.fn(),
}));

vi.mock("~/features/notifications/data/push", () => mocks);

const TITLE = "중요한 소식을 기기에서도 받아보세요";

function renderCard() {
  return renderRoute(() => <NotificationPermissionCard profileId={42} />);
}

describe("NotificationPermissionCard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // 알림함 카드는 첫 진입 창에서 넘긴 사람에게만 다시 권한다.
    recordNotificationPromptHandled(42);
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

  it("첫 진입 창에 아직 답하지 않았으면 그 창에 맡긴다", async () => {
    window.localStorage.clear();
    renderCard();

    // 기록이 없으면 지원 여부도 묻지 않는다.
    await Promise.resolve();
    expect(mocks.getPushSupport).not.toHaveBeenCalled();
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it("첫 진입 창에서 넘긴 뒤에는 알림함에서 다시 권한다", async () => {
    renderCard();

    expect(await screen.findByText(TITLE)).toBeInTheDocument();
    expect(
      screen.getByText(
        "댓글·답글과 그룹 가입 결과를 이 기기로 알립니다. 알림 종류는 알림 설정에서 변경할 수 있습니다.",
      ),
    ).toBeVisible();
    expect(mocks.enableWebPush).not.toHaveBeenCalled();
  });

  it("알림 받기를 선택한 뒤에만 Web Push를 켜고 더 권하지 않는다", async () => {
    const view = renderCard();

    await view.user.click(
      await screen.findByRole("button", { name: "알림 받기" }),
    );

    expect(mocks.enableWebPush).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByText(TITLE)).not.toBeInTheDocument(),
    );
    view.unmount();

    renderCard();
    await Promise.resolve();
    expect(mocks.getPushSupport).toHaveBeenCalledOnce();
  });

  /**
   * 회귀: 권한을 허용한 기기인데도 서버 구독 확인이 "아니오"로 오면 카드가 떴다. 앱을 열 때 빠진
   * 서버 기록을 다시 등록하는 동안이나 확인 요청이 실패한 경우다. 설정의 스위치는 켜져 있는데 카드가 떴다.
   */
  it("권한을 이미 허용한 기기에는 서버 구독 확인과 관계없이 띄우지 않는다", async () => {
    mocks.getPushSupport.mockResolvedValue({
      state: "available",
      permission: "granted",
      subscribed: false,
    });

    renderCard();

    await waitFor(() => expect(mocks.getPushSupport).toHaveBeenCalledOnce());
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it("두 번 닫으면 더 표시하지 않는다", async () => {
    for (let shown = 0; shown < 2; shown += 1) {
      const view = renderCard();
      await view.user.click(
        await screen.findByRole("button", { name: "닫기" }),
      );
      view.unmount();
    }

    renderCard();

    await Promise.resolve();
    expect(mocks.getPushSupport).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it("읽을 수 없는 기록은 이미 답한 것으로 보고 더 권하지 않는다", async () => {
    window.localStorage.setItem("kmla-online:notification-prompt:v2:42", "{");
    renderCard();

    await Promise.resolve();
    expect(mocks.getPushSupport).not.toHaveBeenCalled();
  });
});
