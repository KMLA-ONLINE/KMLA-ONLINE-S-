import { describe, expect, it } from "vitest";

import { layoutMessageThread } from "~/features/messaging/model/message-grouping";
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

/** 두 메시지를 나란히 놓았을 때 이어 붙는지. */
function connects(
  previous: ConversationMessage,
  next: ConversationMessage,
): boolean {
  const [first, second] = layoutMessageThread([previous, next]);
  expect(first?.endsGroup).toBe(second?.startsGroup);
  return !second?.startsGroup;
}

describe("layoutMessageThread", () => {
  it("한 대화 흐름 안에서 같은 작성자가 이어 보낸 메시지를 연결한다", () => {
    const previous = message({ id: "previous" });

    expect(connects(previous, message({ id: "next" }))).toBe(true);
    // 표시 시각(분)이 달라도 5분 안이면 잇는다.
    expect(
      connects(
        previous,
        message({ id: "next", sentAt: "2026-08-28T15:17:04+09:00" }),
      ),
    ).toBe(true);
    expect(connects(previous, message({ id: "next", senderId: "other" }))).toBe(
      false,
    );
    // 탈퇴로 지워진 발신자끼리는 같은 사람인지 모른다.
    expect(
      connects(
        message({ id: "previous", senderId: null }),
        message({ id: "next", senderId: null }),
      ),
    ).toBe(false);
  });

  it("같은 대화 흐름이라도 앞 메시지와 5분 이상 벌어지면 묶음을 끊는다", () => {
    const layout = layoutMessageThread([
      message({ id: "a", sentAt: "2026-08-28T15:00:00+09:00" }),
      message({ id: "b", sentAt: "2026-08-28T15:04:59+09:00" }),
      message({ id: "c", sentAt: "2026-08-28T15:09:59+09:00" }),
      message({ id: "d", sentAt: "2026-08-28T15:14:00+09:00" }),
    ]);

    expect(layout.map(({ startsSession }) => startsSession)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(
      layout.map(({ startsGroup, endsGroup }) => [startsGroup, endsGroup]),
    ).toEqual([
      [true, false],
      [false, true],
      [true, false],
      [false, true],
    ]);
  });

  it("앞 항목과 1시간 이상 벌어지면 새 대화 흐름을 열고 연결을 끊는다", () => {
    const layout = layoutMessageThread([
      message({ id: "a", sentAt: "2026-08-28T15:00:00+09:00" }),
      message({ id: "b", sentAt: "2026-08-28T15:04:00+09:00" }),
      message({ id: "c", sentAt: "2026-08-28T16:04:00+09:00" }),
    ]);

    expect(layout.map(({ startsSession }) => startsSession)).toEqual([
      true,
      false,
      true,
    ]);
    expect(
      layout.map(({ startsGroup, endsGroup }) => [startsGroup, endsGroup]),
    ).toEqual([
      [true, false],
      [false, true],
      [true, true],
    ]);
  });

  it("시스템 메시지도 대화 흐름을 잇는다", () => {
    const layout = layoutMessageThread([
      message({ id: "a", sentAt: "2026-08-28T15:00:00+09:00" }),
      message({
        id: "s",
        sentAt: "2026-08-28T15:50:00+09:00",
        system: { kind: "member_left", profileIds: ["a"], name: null },
      }),
      message({ id: "b", sentAt: "2026-08-28T16:40:00+09:00" }),
    ]);

    expect(layout.map(({ startsSession }) => startsSession)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("날짜, 시스템 및 고정된 메시지에서 연결을 끊는다", () => {
    const previous = message({ id: "previous" });

    expect(
      connects(
        previous,
        // 같은 "오후 3:12"라도 날짜가 다르면 묶지 않는다.
        message({ id: "next", sentAt: "2026-08-29T15:12:05+09:00" }),
      ),
    ).toBe(false);
    expect(
      connects(
        previous,
        message({
          id: "next",
          system: { kind: "member_left", profileIds: ["a"], name: null },
        }),
      ),
    ).toBe(false);
    expect(connects(previous, message({ id: "next", pinned: true }))).toBe(
      false,
    );
  });

  it("반응이 있는 메시지 뒤에서 연결을 끊는다", () => {
    expect(
      connects(
        message({
          id: "previous",
          reactions: [{ reaction: "like", count: 1 }],
        }),
        message({ id: "next" }),
      ),
    ).toBe(false);
    // 집계가 0인 반응은 보이지 않으므로 끊지 않는다.
    expect(
      connects(
        message({
          id: "previous",
          reactions: [{ reaction: "like", count: 0 }],
        }),
        message({ id: "next" }),
      ),
    ).toBe(true);
  });

  it("첫 메시지와 한국 날짜가 바뀌는 메시지에서 간격이 짧아도 새 대화 흐름을 연다", () => {
    const layout = layoutMessageThread([
      message({ id: "a", sentAt: "2026-08-28T23:59:30+09:00" }),
      message({ id: "b", sentAt: "2026-08-28T23:59:50+09:00" }),
      message({ id: "c", sentAt: "2026-08-29T00:01:00+09:00" }),
    ]);

    expect(layout.map(({ startsSession }) => startsSession)).toEqual([
      true,
      false,
      true,
    ]);
    expect(
      layout.map(({ startsGroup, endsGroup }) => [startsGroup, endsGroup]),
    ).toEqual([
      [true, false],
      [false, true],
      [true, true],
    ]);
  });

  it("빈 대화는 빈 배치다", () => {
    expect(layoutMessageThread([])).toEqual([]);
  });
});
