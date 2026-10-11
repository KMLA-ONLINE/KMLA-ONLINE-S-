import { describe, expect, it } from "vitest";

import {
  listMessages,
  loadConversation,
} from "~/features/messaging/data/queries";

describe("messaging queries", () => {
  it("대화방은 최신 페이지와 앞선 페이지 커서를 함께 준다", async () => {
    const conversation = await loadConversation("student-council", 4);

    expect(conversation?.messages.map(({ id }) => id)).toEqual([
      "m6",
      "m7",
      "m8",
      "m9",
    ]);
    expect(conversation?.olderCursor).toEqual({
      id: "m6",
      sentAt: "2026-08-28T15:31:00+09:00",
    });
  });

  it("커서보다 앞선 메시지를 오래된 순서로 이어 읽고 처음에 닿으면 커서가 없다", async () => {
    const conversation = await loadConversation("student-council", 4);
    const middle = await listMessages(
      "student-council",
      conversation!.olderCursor,
      4,
    );
    const first = await listMessages("student-council", middle.olderCursor, 4);

    expect(middle.messages.map(({ id }) => id)).toEqual([
      "m2",
      "m3",
      "m4",
      "m5",
    ]);
    expect(first.messages.map(({ id }) => id)).toEqual(["m1"]);
    expect(first.olderCursor).toBeNull();
  });

  it("커서의 메시지가 사라졌어도 그보다 앞선 메시지만 준다", async () => {
    const page = await listMessages(
      "student-council",
      { id: "gone", sentAt: "2026-08-28T15:20:00+09:00" },
      50,
    );

    expect(page.messages.map(({ id }) => id)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(page.olderCursor).toBeNull();
  });

  it("답장에 원문 인용을, 대화방에 고정 메시지 전체를 붙인다", async () => {
    const conversation = await loadConversation("student-council", 1);

    expect(conversation?.messages.map(({ id }) => id)).toEqual(["m9"]);
    expect(conversation?.pinnedMessages.map(({ id }) => id)).toEqual(["m5"]);

    const page = await listMessages(
      "student-council",
      conversation!.olderCursor,
      1,
    );
    expect(page.messages[0]).toMatchObject({
      id: "m8",
      replyTo: { id: "m7", senderId: "min", body: "", deleted: true },
    });
  });
});
