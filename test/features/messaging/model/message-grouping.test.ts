import { describe, expect, it } from "vitest";

import {
  canConnectMessages,
  hasVisibleMessageReaction,
} from "~/features/messaging/model/message-grouping";
import type { ConversationMessage } from "~/features/messaging/model/types";

function message(
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: "message",
    senderId: "sender",
    body: "본문",
    sentAt: "오후 3:12",
    ...overrides,
  };
}

describe("message grouping", () => {
  it("동일 작성자와 동일 표시 시각의 인접 메시지만 연결한다", () => {
    const previous = message({ id: "previous" });

    expect(canConnectMessages(previous, message({ id: "next" }))).toBe(true);
    expect(
      canConnectMessages(previous, message({ id: "next", senderId: "other" })),
    ).toBe(false);
    expect(
      canConnectMessages(
        previous,
        message({ id: "next", sentAt: "오후 3:13" }),
      ),
    ).toBe(false);
  });

  it("날짜, 시스템 및 고정된 메시지에서 연결을 끊는다", () => {
    const previous = message({ id: "previous" });

    expect(
      canConnectMessages(
        previous,
        message({ id: "next", dayLabel: "2026년 8월 29일 토요일" }),
      ),
    ).toBe(false);
    expect(
      canConnectMessages(previous, message({ id: "next", system: true })),
    ).toBe(false);
    expect(
      canConnectMessages(previous, message({ id: "next", pinned: true })),
    ).toBe(false);
  });

  it("반응이 있는 메시지 뒤에서 연결을 끊는다", () => {
    const previous = message({
      id: "previous",
      reactions: [{ reaction: "like", count: 1 }],
    });
    const next = message({ id: "next" });

    expect(hasVisibleMessageReaction(previous)).toBe(true);
    expect(canConnectMessages(previous, next, true)).toBe(false);
    expect(hasVisibleMessageReaction(next, "love")).toBe(true);
  });
});
