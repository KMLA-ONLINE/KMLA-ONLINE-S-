import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  message_preview_hidden: false,
};

describe("NotificationSettings", () => {
  it("explains unavailable device notifications without exposing server configuration terms", () => {
    renderRoute(() => (
      <NotificationSettings
        initialPreferences={preferences}
        pushSupport={{ state: "unconfigured" }}
        groupPreferences={[]}
      />
    ));

    expect(
      screen.getByText("현재 기기 알림을 사용할 수 없습니다."),
    ).toBeVisible();
    expect(
      screen.queryByRole("switch", { name: "이 기기의 알림" }),
    ).not.toBeInTheDocument();
  });

  it("returns to settings from the notification settings header", async () => {
    const { user } = renderRoute(
      () => (
        <NotificationSettings
          initialPreferences={preferences}
          pushSupport={{ state: "unsupported" }}
          groupPreferences={[]}
        />
      ),
      {
        path: "/settings/noti",
        routes: [{ path: "/settings", Component: () => <h1>설정 도착</h1> }],
      },
    );

    await user.click(screen.getByRole("button", { name: "뒤로" }));

    expect(
      await screen.findByRole("heading", { name: "설정 도착" }),
    ).toBeVisible();
  });

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
        pushSupport={{
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
      screen.queryByRole("switch", { name: "이 기기의 알림" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      notifyChange?.();
      await Promise.resolve();
    });

    expect(
      await screen.findByRole("switch", { name: "이 기기의 알림" }),
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
        pushSupport={{
          state: "available",
          permission: "granted",
          subscribed: false,
        }}
        groupPreferences={[]}
      />
    ));
    const pushSwitch = screen.getByRole("switch", {
      name: "이 기기의 알림",
    });

    await user.click(pushSwitch);

    expect(pushSwitch).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("기기 알림 설정을 변경하고 있습니다."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "기기 알림 설정 변경 중" }),
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

  it("saves the message preview setting on its own and explains the lock screen option", async () => {
    const submitted: FormData[] = [];
    const { user } = renderRoute(
      () => (
        <NotificationSettings
          initialPreferences={preferences}
          pushSupport={{
            state: "available",
            permission: "granted",
            subscribed: true,
          }}
          groupPreferences={[]}
        />
      ),
      {
        action: async ({ request }) => {
          submitted.push(await request.formData());
          return { saved: true };
        },
      },
    );

    const toggle = screen.getByRole("switch", {
      name: "알림에 메시지 내용 가리기",
    });
    expect(toggle).not.toBeChecked();
    expect(
      screen.getByText(
        "잠금 화면에서만 내용을 가리려면 기기 설정의 알림 미리보기를 사용해 주세요.",
      ),
    ).toBeInTheDocument();

    await user.click(toggle);

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(Object.fromEntries(submitted[0])).toEqual({
      intent: "message-preview",
      hidden: "true",
    });
  });

  it("lists only groups whose notification settings differ from the default", () => {
    renderRoute(() => (
      <NotificationSettings
        initialPreferences={preferences}
        pushSupport={{ state: "unsupported" }}
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
        pushSupport={{ state: "unsupported" }}
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
      screen.getByText("앱 알림함과 기기 알림을 각각 설정할 수 있습니다."),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "채널 분리 그룹 알림 수준" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: "채널 분리 그룹 관련 활동 기기 알림",
      }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("switch", {
        name: "채널 분리 그룹 새 게시물 기기 알림",
      }),
    ).toBeChecked();
  });

  it("summarizes what the current settings actually deliver", () => {
    renderRoute(() => (
      <NotificationSettings
        initialPreferences={{ ...preferences, timeline_push_enabled: false }}
        pushSupport={{
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
        pushSupport={{ state: "unsupported" }}
        groupPreferences={[]}
      />
    ));

    expect(
      screen.getByText("이 기기로 오는 기기 알림이 없습니다."),
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
          message_preview_hidden: false,
        }}
        pushSupport={{
          state: "available",
          permission: "granted",
          subscribed: true,
        }}
        groupPreferences={[]}
      />
    ));

    expect(
      screen.getByText("이 기기로 운영 조치 기기 알림만 받습니다."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("그 밖의 알림은 앱 알림함에서 확인합니다."),
    ).toBeInTheDocument();
  });

  describe("in English", () => {
    beforeEach(() => {
      window.localStorage.setItem("kmla-online:language:v1", "en");
    });
    afterEach(() => {
      window.localStorage.clear();
    });

    it("renders the settings screen in English", () => {
      renderRoute(() => (
        <NotificationSettings
          initialPreferences={{ ...preferences, content_push_enabled: false }}
          pushSupport={{
            state: "available",
            permission: "granted",
            subscribed: true,
          }}
          groupPreferences={[]}
        />
      ));

      expect(
        screen.getAllByRole("heading", { name: "Notification settings" }),
      ).not.toHaveLength(0);
      expect(
        screen.getByRole("switch", { name: "Notifications on this device" }),
      ).toBeChecked();
      expect(screen.getByText("On")).toBeInTheDocument();
      expect(
        screen.getByRole("switch", { name: "Comments · Replies" }),
      ).not.toBeChecked();
      expect(
        screen.getByText("You can still see them in the app inbox."),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Notifications on this device — My timeline, Group updates, Account · Permissions, School features",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText("All groups use the default settings."),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    });
  });
});
