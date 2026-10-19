import { describe, expect, it } from "vitest";

import {
  formatLastMessagePreview,
  formatReplyPreview,
  REPLY_PREVIEW_LENGTH,
  toReplyPreviewBody,
} from "~/features/messaging/model/conversation-preview";
import type { ConversationSummary } from "~/features/messaging/model/types";

const ORIGIN = "https://kmla.online";

function conversation(
  overrides: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    id: "room",
    type: "group",
    name: "방",
    viewerId: "me",
    participants: [
      { id: "me", name: "나", avatarUrl: null, active: true },
      { id: "seo", name: "박서현", avatarUrl: null, active: true },
    ],
    lastMessage: {
      senderId: "seo",
      body: "안녕",
      sentAt: "2026-08-28T15:12:00+09:00",
    },
    unreadCount: 0,
    notificationLevel: "all",
    canDelete: false,
    ...overrides,
  };
}

describe("formatLastMessagePreview", () => {
  it("그룹 대화 목록 미리보기의 발신자는 설정된 별명으로 표시한다", () => {
    expect(
      formatLastMessagePreview(
        conversation({
          participants: [
            {
              id: "seo",
              name: "서현이",
              profileName: "박서현",
              nickname: "서현이",
              avatarUrl: null,
              active: true,
            },
          ],
        }),
        ORIGIN,
      ),
    ).toBe("서현이: 안녕");
  });

  it("내 메시지에는 `나:`를, 그룹에서 남이 보낸 메시지에는 발신자 이름을 붙인다", () => {
    expect(formatLastMessagePreview(conversation(), ORIGIN)).toBe(
      "박서현: 안녕",
    );
    const mine = {
      lastMessage: { senderId: "me", body: "응", sentAt: "2026-08-28" },
    };
    expect(formatLastMessagePreview(conversation(mine), ORIGIN)).toBe("나: 응");
    expect(
      formatLastMessagePreview(
        conversation({ ...mine, type: "direct" }),
        ORIGIN,
      ),
    ).toBe("나: 응");
    expect(
      formatLastMessagePreview(conversation({ type: "direct" }), ORIGIN),
    ).toBe("안녕");
  });

  it("멘션은 `@이름` 글자로 보여 준다", () => {
    expect(
      formatLastMessagePreview(
        conversation({
          lastMessage: {
            senderId: "seo",
            body: "[@나](m:1) 확인",
            sentAt: "2026-08-28",
          },
        }),
        ORIGIN,
      ),
    ).toBe("박서현: @나 확인");
  });

  it("메시지가 없는 대화는 빈 미리보기다", () => {
    expect(
      formatLastMessagePreview(conversation({ lastMessage: null }), ORIGIN),
    ).toBe("");
  });

  it("게시물 링크 하나뿐인 메시지는 링크 대신 `게시물`로 부른다", () => {
    const body = `${ORIGIN}/groups/band/posts/6f1c2a4e-8b3d-4c5e-9a7f-0123456789ab`;
    const shared = conversation({
      lastMessage: { senderId: "seo", body, sentAt: "2026-08-28" },
    });
    expect(formatLastMessagePreview(shared, ORIGIN)).toBe("박서현: 게시물");
    expect(formatReplyPreview({ body }, ORIGIN)).toBe("게시물");
    // 사진에 링크만 붙인 메시지는 버블이 카드가 아니므로 미리보기도 링크 그대로다.
    expect(formatReplyPreview({ body, attachmentKind: "image" }, ORIGIN)).toBe(
      body,
    );
    expect(formatReplyPreview({ body: `봐 ${body}` }, ORIGIN)).toBe(
      `봐 ${body}`,
    );
  });
});

describe("formatReplyPreview", () => {
  it("삭제된 원문은 게시물 링크여도 삭제 안내로 부른다", () => {
    expect(
      formatReplyPreview(
        {
          body: "https://kmla.online/groups/band/posts/6f1c2a4e-8b3d-4c5e-9a7f-0123456789ab",
          deleted: true,
        },
        ORIGIN,
      ),
    ).toBe("삭제된 메시지입니다");
  });
});

describe("toReplyPreviewBody", () => {
  it("멘션을 글자로 바꾼 뒤 잘라 토큰이 반쪽 나지 않는다", () => {
    const body = `${"가".repeat(REPLY_PREVIEW_LENGTH - 3)}[@박서현](m:1)`;
    expect(toReplyPreviewBody(body)).toBe(
      `${"가".repeat(REPLY_PREVIEW_LENGTH - 3)}@박서`,
    );
  });
});
