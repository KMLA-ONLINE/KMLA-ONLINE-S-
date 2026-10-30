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

  it("결합 문자(다이어크리틱, 조합형 한글)는 글자 수를 늘리지 않고 이모지로도 보지 않는다", () => {
    // é를 e + 결합 악센트로, 한글을 자모 조합으로 쓴 경우
    expect(countMessageGraphemes("e\u0301")).toBe(1);
    expect(countMessageGraphemes("\u1112\u1161\u11ab")).toBe(1);
    expect(countMessageGraphemes("👍\u0301")).toBe(1);
    expect(getEmojiOnlyMessageGraphemes("e\u0301")).toBeNull();
    expect(getEmojiOnlyMessageGraphemes("\u1112\u1161\u11ab")).toBeNull();
    expect(getEmojiOnlyMessageGraphemes("👍\u0301")).toBeNull();
    expect(parseMessageText("cafe\u0301 https://a.b/x\u0301")).toEqual([
      { type: "text", value: "cafe\u0301 " },
      { type: "link", value: "https://a.b/x\u0301" },
    ]);
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

  it("닫는 괄호 뒤에 문장 부호가 붙어도 괄호를 링크에서 제외한다", () => {
    expect(parseMessageText("(자료: https://example.com/a).")).toEqual([
      { type: "text", value: "(자료: " },
      { type: "link", value: "https://example.com/a" },
      { type: "text", value: ")." },
    ]);
  });

  it("멘션 토큰을 가르고 멘션에 붙여 친 글자는 링크로 잇지 않는다", () => {
    expect(
      parseMessageText("[@박서현](m:1)https://example.com [@모든 사람](m:0)!"),
    ).toEqual([
      { type: "mention", ordinal: 1, label: "박서현" },
      { type: "link", value: "https://example.com" },
      { type: "text", value: " " },
      { type: "mention", ordinal: 0, label: "모든 사람" },
      { type: "text", value: "!" },
    ]);
  });

  it("URL 내부에서 짝이 맞는 괄호는 유지한다", () => {
    expect(parseMessageText("https://example.com/docs_(v1).")).toEqual([
      { type: "link", value: "https://example.com/docs_(v1)" },
      { type: "text", value: "." },
    ]);
  });
});
