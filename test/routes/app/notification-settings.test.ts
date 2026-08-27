import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getNotificationPreferences: vi.fn(),
  getPushSupport: vi.fn(),
  listMyGroupNotificationPreferences: vi.fn(),
  updateGroupNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
}));

vi.mock("~/features/notifications", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...mocks,
}));

import { clientAction, clientLoader } from "~/routes/app/notification-settings";

const preferences = {
  account_push_enabled: true,
  content_push_enabled: true,
  group_push_enabled: false,
  school_push_enabled: true,
  timeline_push_enabled: false,
};

describe("notification settings route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getNotificationPreferences.mockResolvedValue(preferences);
    mocks.getPushSupport.mockResolvedValue({ state: "unsupported" });
    mocks.listMyGroupNotificationPreferences.mockResolvedValue([]);
  });

  it("loads account preferences and device state in parallel", async () => {
    await expect(clientLoader()).resolves.toEqual({
      preferences,
      pushSupport: { state: "unsupported" },
      groupPreferences: [],
    });
    expect(mocks.getNotificationPreferences).toHaveBeenCalledOnce();
    expect(mocks.getPushSupport).toHaveBeenCalledOnce();
    expect(mocks.listMyGroupNotificationPreferences).toHaveBeenCalledOnce();
  });

  it("writes a complete preference snapshot", async () => {
    await clientAction({
      request: new Request("https://example.com/noti/settings", {
        method: "POST",
        body: new URLSearchParams({
          intent: "preferences",
          account_push_enabled: "true",
          content_push_enabled: "false",
          group_push_enabled: "true",
          school_push_enabled: "false",
          timeline_push_enabled: "true",
        }),
      }),
    } as never);

    expect(mocks.updateNotificationPreferences).toHaveBeenCalledWith({
      account_push_enabled: true,
      content_push_enabled: false,
      group_push_enabled: true,
      school_push_enabled: false,
      timeline_push_enabled: true,
    });
  });

  it("writes one complete group preference snapshot", async () => {
    await clientAction({
      request: new Request("https://example.com/noti/settings", {
        method: "POST",
        body: new URLSearchParams({
          intent: "group-preferences",
          groupId: "11111111-1111-4111-8111-111111111111",
          level: "all",
          contentPushEnabled: "false",
          newPostPushEnabled: "true",
        }),
      }),
    } as never);

    expect(mocks.updateGroupNotificationPreferences).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "all",
      false,
      true,
    );
  });

  it("turns group Push off when the inbox level is none", async () => {
    await clientAction({
      request: new Request("https://example.com/noti/settings", {
        method: "POST",
        body: new URLSearchParams({
          intent: "group-preferences",
          groupId: "11111111-1111-4111-8111-111111111111",
          level: "none",
          contentPushEnabled: "true",
          newPostPushEnabled: "true",
        }),
      }),
    } as never);

    expect(mocks.updateGroupNotificationPreferences).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "none",
      false,
      false,
    );
  });

  it("returns a recoverable error when a preference update fails", async () => {
    mocks.updateNotificationPreferences.mockRejectedValueOnce(
      new Error("network unavailable"),
    );

    await expect(
      clientAction({
        request: new Request("https://example.com/noti/settings", {
          method: "POST",
          body: new URLSearchParams({
            intent: "preferences",
            account_push_enabled: "true",
            content_push_enabled: "true",
            group_push_enabled: "true",
            school_push_enabled: "true",
            timeline_push_enabled: "true",
          }),
        }),
      } as never),
    ).resolves.toBeDefined();
  });
});
