import { describe, expect, it } from "vitest";

import { NotificationInbox } from "~/features/notifications/components/notification-inbox";
import type { NotificationItem } from "~/features/notifications/model/types";
import { renderRoute, screen } from "../../../router";

function restrictedNotification(): NotificationItem {
  return {
    actor_avatar_url: null,
    actor_count: 1,
    actor_display_name: "",
    actor_identity: "system",
    category: "moderation",
    comment_id: "",
    created_at: "2026-08-31T00:00:00Z",
    detail: "반복적인 익명 괴롭힘",
    group_id: "group-id",
    group_name: "테스트 그룹",
    id: "notification-id",
    importance: "high",
    kind: "anonymous_activity_restricted",
    last_activity_at: "2026-08-31T00:00:00Z",
    post_id: "",
    read_at: "",
    reservation_id: 0,
    restriction_expires_at: "2026-09-07T09:30:00Z",
    target_profile_id: 0,
    title: "그룹 익명 활동이 제한되었습니다.",
  };
}

describe("NotificationInbox", () => {
  it("shows restriction detail and expiry only for the restriction kind", () => {
    renderRoute(() => (
      <NotificationInbox
        initialPage={{ items: [restrictedNotification()], nextCursor: null }}
      />
    ));

    expect(
      screen.getByText("사유: 반복적인 익명 괴롭힘", { exact: false }),
    ).toHaveTextContent(/만료:/);
  });
});
