import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NotificationSettings } from "~/features/notifications/components/notification-settings";
import { renderRoute } from "../../../router";

const mocks = vi.hoisted(() => ({
  disableWebPush: vi.fn(),
  enableWebPush: vi.fn(),
  getPermissionHelpPlatform: vi.fn(() => "android-app"),
  getPushSupport: vi.fn(),
  watchNotificationPermission: vi.fn(
    (_onChange: () => void) => () => undefined,
  ),
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
  it("guides a blocked device and restores the switch once allowed", async () => {
    let notifyChange: (() => void) | null = null;
    mocks.watchNotificationPermission.mockImplementation(
      (onChange: () => void) => {
        notifyChange = onChange;
        return () => undefined;
      },
    );
    mocks.getPushSupport.mockResolvedValue({
      state: "available",
      permission: "default",
      subscribed: false,
    });

    renderRoute(() => (
      <NotificationSettings
        initialPreferences={preferences}
        initialPushSupport={{
          state: "available",
          permission: "denied",
          subscribed: false,
        }}
        groupPreferences={[]}
      />
    ));

    expect(
      screen.getByText(
        "홈 화면의 앱 아이콘을 길게 눌러 앱 정보 → 알림에서 허용해 주세요.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: "이 기기의 Web Push" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      notifyChange?.();
      await Promise.resolve();
    });

    expect(
      await screen.findByRole("switch", { name: "이 기기의 Web Push" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/앱 정보 → 알림에서 허용해 주세요/),
    ).not.toBeInTheDocument();
  });

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
    expect(screen.getByRole("switch", { name: "댓글 · 답글" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

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
  });

  it("keeps mandatory moderation Push in the summary", () => {
    renderRoute(() => (
      <NotificationSettings
        initialPreferences={{
          account_push_enabled: false,
          content_push_enabled: false,
          group_push_enabled: false,
          school_push_enabled: false,
          timeline_push_enabled: false,
        }}
        initialPushSupport={{
          state: "available",
          permission: "granted",
          subscribed: true,
        }}
        groupPreferences={[]}
      />
    ));

    expect(
      screen.getByText("이 기기로 운영 조치 Push만 받습니다."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("그 밖의 알림은 앱 알림함에서 확인합니다."),
    ).toBeInTheDocument();
  });
});
