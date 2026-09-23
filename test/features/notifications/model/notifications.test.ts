import { describe, expect, it } from "vitest";

import {
  getDefaultGroupNotificationLevel,
  getNotificationCursor,
  groupNotifications,
  isDefaultGroupNotificationPreference,
  sanitizeNotificationDestination,
} from "~/features/notifications";
import { getNotificationMessage } from "~/features/notifications/model/notifications";
import type { NotificationItem } from "~/features/notifications";

function notification(id: string, lastActivityAt: string): NotificationItem {
  return {
    actor_avatar_url: null,
    actor_count: 1,
    actor_display_name: "홍길동",
    actor_identity: "identified",
    category: "content",
    comment_excerpt: null,
    comment_id: "",
    created_at: lastActivityAt,
    detail: "",
    group_id: "",
    group_name: "",
    id,
    importance: "normal",
    kind: "post_commented",
    last_activity_at: lastActivityAt,
    post_id: "post-id",
    reaction: null,
    read_at: "",
    reservation_id: 0,
    restriction_expires_at: "",
    target_profile_id: 0,
    title: "게시물에 댓글을 남겼습니다.",
  };
}

describe("notification list model", () => {
  it("groups by the last activity timestamp at the 6 and 24 hour boundaries", () => {
    const now = new Date("2026-08-26T12:00:00.000Z");
    const recentSixHours = notification(
      "recent-six-hours",
      "2026-08-26T06:00:00.001Z",
    );
    const sixHoursOld = notification(
      "six-hours-old",
      "2026-08-26T06:00:00.000Z",
    );
    const recentDay = notification("recent-day", "2026-08-25T12:00:00.001Z");
    const older = notification("older", "2026-08-25T12:00:00.000Z");

    expect(
      groupNotifications([recentSixHours, sixHoursOld, recentDay, older], now),
    ).toEqual({
      recentSixHours: [recentSixHours],
      recentDay: [sixHoursOld, recentDay],
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
        contentPushEnabled: true,
        newPostPushEnabled: false,
      }),
    ).toBe(true);
    expect(
      isDefaultGroupNotificationPreference({
        ...base,
        groupKind: "unofficial",
        level: "direct",
        contentPushEnabled: true,
        newPostPushEnabled: false,
      }),
    ).toBe(true);

    // 수준은 기본값이어도 새 게시물 Push를 켰다면 사용자가 손댄 그룹이다.
    expect(
      isDefaultGroupNotificationPreference({
        ...base,
        groupKind: "official",
        level: "all",
        contentPushEnabled: true,
        newPostPushEnabled: true,
      }),
    ).toBe(false);
    expect(
      isDefaultGroupNotificationPreference({
        ...base,
        groupKind: "unofficial",
        level: "none",
        contentPushEnabled: false,
        newPostPushEnabled: false,
      }),
    ).toBe(false);
    expect(
      isDefaultGroupNotificationPreference({
        ...base,
        groupKind: "unofficial",
        level: "direct",
        contentPushEnabled: false,
        newPostPushEnabled: false,
      }),
    ).toBe(false);
  });
});

describe("notification message", () => {
  const base = notification("id", "2026-08-26T12:00:00.000Z");

  it("shows only the comment body, with mentions unwrapped and lines folded", () => {
    expect(
      getNotificationMessage({
        ...base,
        kind: "comment_replied",
        comment_excerpt: "[@박새벽](m:1) 저도요\n\n몇 시까지요?",
      }),
    ).toBe("@박새벽 저도요 몇 시까지요?");
  });

  it("drops a mention token cut off by the server's excerpt limit", () => {
    for (const tail of [
      "[@김철",
      "[@김철수]",
      "[@김철수](",
      "[@김철수](m:",
      "[@김철수](m:1",
    ]) {
      expect(
        getNotificationMessage({
          ...base,
          kind: "post_commented",
          comment_excerpt: `[@박새벽](m:1) 반가워요 ${tail}`,
        }),
      ).toBe("@박새벽 반가워요");
    }
  });

  it("falls back to the stored title when the comment body is unavailable", () => {
    expect(
      getNotificationMessage({
        ...base,
        kind: "post_commented",
        comment_excerpt: null,
      }),
    ).toBe(base.title);
  });

  it("names the reaction kind and whether a post or a comment received it", () => {
    expect(
      getNotificationMessage({
        ...base,
        kind: "post_reacted",
        reaction: "love",
      }),
    ).toBe("게시물에 ‘하트’ 반응을 남겼습니다.");
    expect(
      getNotificationMessage({
        ...base,
        kind: "comment_reacted",
        reaction: null,
      }),
    ).toBe("댓글에 반응을 남겼습니다.");
  });

  it("keeps the stored title for other kinds", () => {
    expect(
      getNotificationMessage({
        ...base,
        kind: "group_posted",
        title: "주말 모임 공지",
        comment_excerpt: "무시된다",
      }),
    ).toBe("주말 모임 공지");
  });
});
