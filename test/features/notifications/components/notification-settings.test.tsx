import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NotificationSettings } from "~/features/notifications/components/notification-settings";
import { renderRoute } from "../../../router";

const mocks = vi.hoisted(() => ({
  disableWebPush: vi.fn(),
  enableWebPush: vi.fn(),
  getPushSupport: vi.fn(),
}));

vi.mock("~/features/notifications/data/push", () => mocks);

const preferences = {
  account_push_enabled: true,
  content_push_enabled: true,
  group_push_enabled: true,
  school_push_enabled: true,
  timeline_push_enabled: true,
};

describe("NotificationSettings", () => {
  it("shows progress while enabling Web Push", async () => {
    let finishEnable:
      | ((value: {
          state: "available";
          permission: "granted";
          subscribed: true;
        }) => void)
      | null = null;
    mocks.enableWebPush.mockReturnValue(
      new Promise((resolve) => {
        finishEnable = resolve;
      }),
    );

    const { user } = renderRoute(() => (
      <NotificationSettings
        initialPreferences={preferences}
        initialPushSupport={{
          state: "available",
          permission: "granted",
          subscribed: false,
        }}
        groupPreferences={[]}
      />
    ));
    const pushSwitch = screen.getByRole("switch", {
      name: "이 기기의 Web Push",
    });

    await user.click(pushSwitch);

    expect(pushSwitch).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("Web Push 설정을 변경하고 있습니다."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Web Push 설정 변경 중" }),
    ).toBeInTheDocument();

    await act(async () => {
      finishEnable?.({
        state: "available",
        permission: "granted",
        subscribed: true,
      });
      await Promise.resolve();
    });

    await waitFor(() => expect(pushSwitch).toBeChecked());
    expect(
      screen.getByText("이 기기에서 새 소식을 받을 수 있습니다."),
    ).toBeInTheDocument();
  });

  it("keeps group notification controls aligned as labels change", () => {
    renderRoute(() => (
      <NotificationSettings
        initialPreferences={preferences}
        initialPushSupport={{ state: "unsupported" }}
        groupPreferences={[
          {
            groupId: "11111111-1111-4111-8111-111111111111",
            groupName: "긴 이름의 테스트 그룹",
            level: "direct",
            newPostPushEnabled: false,
          },
        ]}
      />
    ));

    expect(
      screen.getByRole("combobox", {
        name: "긴 이름의 테스트 그룹 알림 수준",
      }),
    ).toHaveClass("w-28");
  });
});
