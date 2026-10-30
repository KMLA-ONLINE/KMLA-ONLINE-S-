import { describe, expect, it } from "vitest";

import { applyMessageReaction } from "~/features/messaging/model/message-reactions";

describe("applyMessageReaction", () => {
  it("새 반응을 더한다", () => {
    expect(
      applyMessageReaction({ reactions: [{ reaction: "👍", count: 2 }] }, "❤️"),
    ).toEqual({
      reactions: [
        { reaction: "👍", count: 2 },
        { reaction: "❤️", count: 1 },
      ],
      myReaction: "❤️",
    });
  });

  it("내 이전 반응을 빼고 바꾸며, 0이 된 종류는 지운다", () => {
    expect(
      applyMessageReaction(
        { reactions: [{ reaction: "👍", count: 1 }], myReaction: "👍" },
        "😆",
      ),
    ).toEqual({
      reactions: [{ reaction: "😆", count: 1 }],
      myReaction: "😆",
    });
    expect(
      applyMessageReaction(
        { reactions: [{ reaction: "👍", count: 3 }], myReaction: "👍" },
        null,
      ),
    ).toEqual({
      reactions: [{ reaction: "👍", count: 2 }],
      myReaction: null,
    });
  });

  it("처음 보는 이모지도 반응 종류로 더한다", () => {
    expect(applyMessageReaction({ reactions: [] }, "🫡").reactions).toEqual([
      { reaction: "🫡", count: 1 },
    ]);
  });
});
