import { describe, expect, it } from "vitest";

import {
  getDefaultGroupNotificationLevel,
  getNotificationCursor,
  groupNotifications,
  isDefaultGroupNotificationPreference,
  sanitizeNotificationDestination,
} from "~/features/notifications";
import type { NotificationItem } from "~/features/notifications";

function notification(id: string, lastActivityAt: string): NotificationItem {
  return {
    actor_avatar_url: null,
    actor_count: 1,
    actor_display_name: "홍길동",
    actor_identity: "identified",
    category: "content",
    comment_id: "",
    created_at: lastActivityAt,
    group_id: "",
    id,
    importance: "normal",
    kind: "post_commented",
    last_activity_at: lastActivityAt,
    post_id: "post-id",
    read_at: "",
    reservation_id: 0,
    target_profile_id: 0,
    title: "게시물에 댓글을 남겼습니다.",
  };
}

describe("notification list model", () => {
  it("groups by the last activity timestamp at the exact 24 hour boundary", () => {
    const now = new Date("2026-08-26T12:00:00.000Z");
    const recent = notification("recent", "2026-08-25T12:00:00.001Z");
    const older = notification("older", "2026-08-25T12:00:00.000Z");

    expect(groupNotifications([recent, older], now)).toEqual({
      recent: [recent],
      older: [older],
    });
  });

  it("builds the next cursor from the final full page", () => {
    const items = [
      notification("first", "2026-08-26T11:00:00.000Z"),
      notification("last", "2026-08-26T10:00:00.000Z"),
    ];

    expect(getNotificationCursor(items, 2)).toEqual({
      beforeId: "last",
      beforeLastActivityAt: "2026-08-26T10:00:00.000Z",
    });
    expect(getNotificationCursor(items, 3)).toBeNull();
  });
});

describe("notification destination safety", () => {
  it.each(["/", "/noti", "/groups/physics?post=1"])(
    "accepts app-relative destination %s",
    (destination) => {
      expect(sanitizeNotificationDestination(destination)).toBe(destination);
    },
  );

  it.each([
    "https://evil.example",
    "//evil.example/path",
    "javascript:alert(1)",
    "noti",
    "",
  ])("rejects unsafe destination %s", (destination) => {
    expect(sanitizeNotificationDestination(destination)).toBe("/noti");
  });
});

describe("group notification defaults", () => {
  it("uses all for official groups and direct for unofficial groups", () => {
    expect(getDefaultGroupNotificationLevel("official")).toBe("all");
    expect(getDefaultGroupNotificationLevel("unofficial")).toBe("direct");
  });

  it("treats a group as default only when both fields match", () => {
    const base = { groupId: "g", groupName: "그룹" } as const;

    expect(
      isDefaultGroupNotificationPreference({
        ...base,
        groupKind: "official",
        level: "all",
        newPostPushEnabled: false,
      }),
    ).toBe(true);
    expect(
      isDefaultGroupNotificationPreference({
        ...base,
        groupKind: "unofficial",
        level: "direct",
        newPostPushEnabled: false,
      }),
    ).toBe(true);

    // 수준은 기본값이어도 새 게시물 Push를 켰다면 사용자가 손댄 그룹이다.
    expect(
      isDefaultGroupNotificationPreference({
        ...base,
        groupKind: "official",
        level: "all",
        newPostPushEnabled: true,
      }),
    ).toBe(false);
    expect(
      isDefaultGroupNotificationPreference({
        ...base,
        groupKind: "unofficial",
        level: "none",
        newPostPushEnabled: false,
      }),
    ).toBe(false);
  });
});
