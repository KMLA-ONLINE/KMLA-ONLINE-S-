import { describe, expect, it } from "vitest";

import { formatLastMessagePreview } from "~/features/messaging/model/conversation-preview";
import type { ConversationSummary } from "~/features/messaging/model/types";

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
    muted: false,
    canDelete: false,
    ...overrides,
  };
}

describe("formatLastMessagePreview", () => {
  it("내 메시지에는 `나:`를, 그룹에서 남이 보낸 메시지에는 발신자 이름을 붙인다", () => {
    expect(formatLastMessagePreview(conversation())).toBe("박서현: 안녕");
    const mine = {
      lastMessage: { senderId: "me", body: "응", sentAt: "2026-08-28" },
    };
    expect(formatLastMessagePreview(conversation(mine))).toBe("나: 응");
    expect(
      formatLastMessagePreview(conversation({ ...mine, type: "direct" })),
    ).toBe("나: 응");
    expect(formatLastMessagePreview(conversation({ type: "direct" }))).toBe(
      "안녕",
    );
  });

  it("메시지가 없는 대화는 빈 미리보기다", () => {
    expect(formatLastMessagePreview(conversation({ lastMessage: null }))).toBe(
      "",
    );
  });
});
