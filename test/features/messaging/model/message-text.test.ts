import { describe, expect, it } from "vitest";

import {
  countMessageGraphemes,
  getEmojiOnlyMessageGraphemes,
} from "~/features/messaging/model/message-text";

describe("message text", () => {
  it("복합 이모지를 grapheme cluster 단위로 센다", () => {
    expect(countMessageGraphemes("👍🏽👨‍👩‍👧‍👦🇰🇷1️⃣")).toBe(4);
  });

  it("1개 이상 5개 이하의 이모지만 확대 대상으로 판정한다", () => {
    expect(getEmojiOnlyMessageGraphemes("👍🏽❤️👨‍👩‍👧‍👦🇰🇷1️⃣")).toHaveLength(5);
    expect(getEmojiOnlyMessageGraphemes("👍👍👍👍👍👍")).toBeNull();
    expect(getEmojiOnlyMessageGraphemes("👍 좋아요")).toBeNull();
    expect(getEmojiOnlyMessageGraphemes(" 👍 ")).toBeNull();
    expect(getEmojiOnlyMessageGraphemes("1")).toBeNull();
    expect(getEmojiOnlyMessageGraphemes("©")).toBeNull();
    expect(getEmojiOnlyMessageGraphemes("©️")).toEqual(["©️"]);
    expect(getEmojiOnlyMessageGraphemes("")).toBeNull();
  });
});
