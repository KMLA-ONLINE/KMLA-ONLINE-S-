import { describe, expect, it } from "vitest";

import {
  COMMENT_MAX_LENGTH,
  countCommentGraphemes,
  normalizeCommentBody,
  parseCommentText,
  validateCommentBody,
} from "~/features/posts/model/comment-text";

describe("normalizeCommentBody", () => {
  it("normalizes line endings and trims the edges only", () => {
    expect(normalizeCommentBody("\n\n첫 줄\r\n\r\n둘째 줄\n\n")).toBe(
      "첫 줄\n\n둘째 줄",
    );
  });
});

describe("countCommentGraphemes", () => {
  it("counts a composed emoji as one character", () => {
    expect(countCommentGraphemes("👨‍👩‍👧‍👦")).toBe(1);
    expect(countCommentGraphemes("🇰🇷")).toBe(1);
    expect(countCommentGraphemes("가나다")).toBe(3);
  });
});

describe("validateCommentBody", () => {
  it("allows an empty body when the comment has an image", () => {
    expect(validateCommentBody("", true)).toBeNull();
  });
  it("rejects a blank body", () => {
    expect(validateCommentBody("   \n  ")).toBe("댓글 내용을 입력해 주세요.");
  });

  it("accepts a body at the limit and rejects one past it", () => {
    expect(validateCommentBody("가".repeat(COMMENT_MAX_LENGTH))).toBeNull();
    expect(validateCommentBody("가".repeat(COMMENT_MAX_LENGTH + 1))).toContain(
      "5,000자",
    );
  });
});

describe("parseCommentText", () => {
  it("keeps line breaks as their own segments", () => {
    expect(parseCommentText("첫 줄\n둘째 줄")).toEqual([
      { type: "text", value: "첫 줄" },
      { type: "break" },
      { type: "text", value: "둘째 줄" },
    ]);
  });

  it("turns http(s) urls into links and leaves surrounding text alone", () => {
    expect(parseCommentText("여기 https://kmla.hs.kr 참고")).toEqual([
      { type: "text", value: "여기 " },
      { type: "link", value: "https://kmla.hs.kr" },
      { type: "text", value: " 참고" },
    ]);
  });

  it("does not swallow the punctuation that ends a sentence", () => {
    expect(parseCommentText("자료는 https://kmla.hs.kr/a.")).toEqual([
      { type: "text", value: "자료는 " },
      { type: "link", value: "https://kmla.hs.kr/a" },
      { type: "text", value: "." },
    ]);
  });

  it("keeps an unmatched closing bracket out of the link", () => {
    expect(parseCommentText("(https://kmla.hs.kr)")).toEqual([
      { type: "text", value: "(" },
      { type: "link", value: "https://kmla.hs.kr" },
      { type: "text", value: ")" },
    ]);
  });

  it("leaves unsupported schemes as plain text", () => {
    expect(parseCommentText("javascript:alert(1)")).toEqual([
      { type: "text", value: "javascript:alert(1)" },
    ]);
    expect(parseCommentText("ftp://example.com/a")).toEqual([
      { type: "text", value: "ftp://example.com/a" },
    ]);
  });
});
