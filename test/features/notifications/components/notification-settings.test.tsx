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
            // 공식 그룹의 기본값은 `all`이라 `direct`는 사용자가 바꾼 상태다.
            groupKind: "official",
            level: "direct",
            contentPushEnabled: true,
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

  it("lists only groups whose notification settings differ from the default", () => {
    renderRoute(() => (
      <NotificationSettings
        initialPreferences={preferences}
        initialPushSupport={{ state: "unsupported" }}
        groupPreferences={[
          {
            groupId: "11111111-1111-4111-8111-111111111111",
            groupName: "기본값 공식 그룹",
            groupKind: "official",
            level: "all",
            contentPushEnabled: true,
            newPostPushEnabled: false,
          },
          {
            groupId: "22222222-2222-4222-8222-222222222222",
            groupName: "기본값 비공식 그룹",
            groupKind: "unofficial",
            level: "direct",
            contentPushEnabled: true,
            newPostPushEnabled: false,
          },
          {
            groupId: "33333333-3333-4333-8333-333333333333",
            groupName: "직접 바꾼 그룹",
            groupKind: "unofficial",
            level: "none",
            contentPushEnabled: false,
            newPostPushEnabled: false,
          },
        ]}
      />
    ));

    expect(screen.getByText("직접 바꾼 그룹")).toBeInTheDocument();
    expect(screen.queryByText("기본값 공식 그룹")).not.toBeInTheDocument();
    expect(screen.queryByText("기본값 비공식 그룹")).not.toBeInTheDocument();
  });

  it("shows inbox and group Push controls independently", () => {
    renderRoute(() => (
      <NotificationSettings
        initialPreferences={preferences}
        initialPushSupport={{ state: "unsupported" }}
        groupPreferences={[
          {
            groupId: "11111111-1111-4111-8111-111111111111",
            groupName: "채널 분리 그룹",
            groupKind: "official",
            level: "all",
            contentPushEnabled: false,
            newPostPushEnabled: true,
          },
        ]}
      />
    ));

    expect(
      screen.getByRole("combobox", { name: "채널 분리 그룹 알림 수준" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "채널 분리 그룹 관련 활동 Push" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("switch", { name: "채널 분리 그룹 새 게시물 Push" }),
    ).toBeChecked();
  });

  it("summarizes what the current settings actually deliver", () => {
    renderRoute(() => (
      <NotificationSettings
        initialPreferences={{ ...preferences, timeline_push_enabled: false }}
        initialPushSupport={{
          state: "available",
          permission: "granted",
          subscribed: true,
        }}
        groupPreferences={[]}
      />
    ));

    expect(
      screen.getByText(
        "이 기기로 받는 알림 — 댓글 · 답글, 그룹 운영 소식, 계정 · 권한, 학교 기능",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("그 밖의 알림은 앱 알림함에서만 확인합니다."),
    ).toBeInTheDocument();
  });

  it("says everything stays in the inbox when this device has no push", () => {
    renderRoute(() => (
      <NotificationSettings
        initialPreferences={preferences}
        initialPushSupport={{ state: "unsupported" }}
        groupPreferences={[]}
      />
    ));

    expect(
      screen.getByText("이 기기로 오는 Push가 없습니다."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("받도록 설정한 알림은 앱 알림함에서 확인합니다."),
    ).toBeInTheDocument();
  });
});
