import { describe, expect, it } from "vitest";

import {
  countMessageGraphemes,
  getEmojiOnlyMessageGraphemes,
  parseMessageText,
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

  it("URL 뒤의 문장 부호와 짝이 맞지 않는 닫는 괄호를 링크에서 제외한다", () => {
    expect(
      parseMessageText("확인 https://example.com., (https://kmla.hs.kr)"),
    ).toEqual([
      { type: "text", value: "확인 " },
      { type: "link", value: "https://example.com" },
      { type: "text", value: ".," },
      { type: "text", value: " (" },
      { type: "link", value: "https://kmla.hs.kr" },
      { type: "text", value: ")" },
    ]);
  });

  it("URL 내부에서 짝이 맞는 괄호는 유지한다", () => {
    expect(parseMessageText("https://example.com/docs_(v1).")).toEqual([
      { type: "link", value: "https://example.com/docs_(v1)" },
      { type: "text", value: "." },
    ]);
  });
});
