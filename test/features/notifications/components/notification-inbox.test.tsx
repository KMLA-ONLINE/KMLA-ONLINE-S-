import { describe, expect, it, vi } from "vitest";

import { NotificationInbox } from "~/features/notifications/components/notification-inbox";
import type { NotificationItem } from "~/features/notifications/model/types";
import { renderRoute, screen, waitFor } from "../../../router";

function restrictedNotification(): NotificationItem {
  return {
    actor_avatar_url: null,
    actor_count: 1,
    actor_display_name: "",
    actor_identity: "system",
    category: "moderation",
    comment_excerpt: null,
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
    reaction: null,
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
        profileId={1}
      />
    ));

    expect(
      screen.getByText("사유: 반복적인 익명 괴롭힘", { exact: false }),
    ).toHaveTextContent(/만료:/);
  });

  it("shows the comment body and the reaction kind in place of the stored title", () => {
    renderRoute(() => (
      <NotificationInbox
        initialPage={{
          items: [
            {
              ...restrictedNotification(),
              id: "comment",
              kind: "post_commented",
              title: "내 게시물에 새 댓글이 등록되었습니다.",
              comment_excerpt: "저도 참석할게요!",
            },
            {
              ...restrictedNotification(),
              id: "reaction",
              kind: "post_reacted",
              title: "새 반응이 등록되었습니다.",
              reaction: "haha",
            },
          ],
          nextCursor: null,
        }}
        profileId={1}
      />
    ));

    expect(screen.getByText("저도 참석할게요!")).toBeInTheDocument();
    expect(
      screen.getByText("게시물에 ‘웃겨요’ 반응을 남겼습니다."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/등록되었습니다/)).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole("presentation", { hidden: true })
        .some((image) => image.getAttribute("src")?.endsWith("1f606.svg")),
    ).toBe(true);
  });

  it("loads older notifications through the non-revalidating page route", async () => {
    const pageLoader = vi.fn((_args: { request: Request }) =>
      Promise.resolve({
        items: [],
        nextCursor: null,
      }),
    );
    const { user } = renderRoute(
      () => (
        <NotificationInbox
          initialPage={{
            items: [restrictedNotification()],
            nextCursor: {
              beforeId: "notification-id",
              beforeLastActivityAt: "2026-08-31T00:00:00Z",
            },
          }}
          profileId={1}
        />
      ),
      {
        path: "/noti",
        routes: [{ path: "/noti/page", loader: pageLoader }],
      },
    );

    await user.click(screen.getByRole("button", { name: "이전 알림 더 보기" }));

    await waitFor(() => expect(pageLoader).toHaveBeenCalledOnce());
    expect(pageLoader.mock.calls[0][0].request.url).toBe(
      "http://localhost/noti/page?beforeId=notification-id&beforeLastActivityAt=2026-08-31T00%3A00%3A00Z",
    );
  });
});
