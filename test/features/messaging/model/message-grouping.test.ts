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
    sentAt: "2026-08-28T15:12:05+09:00",
    ...overrides,
  };
}

describe("message grouping", () => {
  it("동일 작성자와 동일 표시 시각의 인접 메시지만 연결한다", () => {
    const previous = message({ id: "previous" });

    expect(canConnectMessages(previous, message({ id: "next" }))).toBe(true);
    expect(
      canConnectMessages(
        previous,
        message({ id: "next", sentAt: "2026-08-28T15:12:59+09:00" }),
      ),
    ).toBe(true);
    expect(
      canConnectMessages(previous, message({ id: "next", senderId: "other" })),
    ).toBe(false);
    expect(
      canConnectMessages(
        previous,
        message({ id: "next", sentAt: "2026-08-28T15:13:00+09:00" }),
      ),
    ).toBe(false);
  });

  it("날짜, 시스템 및 고정된 메시지에서 연결을 끊는다", () => {
    const previous = message({ id: "previous" });

    expect(
      canConnectMessages(
        previous,
        // 같은 "오후 3:12"라도 날짜가 다르면 묶지 않는다.
        message({ id: "next", sentAt: "2026-08-29T15:12:05+09:00" }),
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
    expect(
      hasVisibleMessageReaction(
        message({ reactions: [{ reaction: "love", count: 1 }] }),
      ),
    ).toBe(true);
  });
});
