import { describe, expect, it } from "vitest";

import { applyMessageReaction } from "~/features/messaging/model/message-reactions";

describe("applyMessageReaction", () => {
  it("새 반응을 더한다", () => {
    expect(
      applyMessageReaction(
        { reactions: [{ reaction: "like", count: 2 }] },
        "love",
      ),
    ).toEqual({
      reactions: [
        { reaction: "like", count: 2 },
        { reaction: "love", count: 1 },
      ],
      myReaction: "love",
    });
  });

  it("내 이전 반응을 빼고 바꾸며, 0이 된 종류는 지운다", () => {
    expect(
      applyMessageReaction(
        { reactions: [{ reaction: "like", count: 1 }], myReaction: "like" },
        "haha",
      ),
    ).toEqual({
      reactions: [{ reaction: "haha", count: 1 }],
      myReaction: "haha",
    });
    expect(
      applyMessageReaction(
        { reactions: [{ reaction: "like", count: 3 }], myReaction: "like" },
        null,
      ),
    ).toEqual({
      reactions: [{ reaction: "like", count: 2 }],
      myReaction: null,
    });
  });
});
