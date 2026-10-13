import { describe, expect, it } from "vitest";

import { searchExcerpt } from "~/features/messaging/model/message-search";

describe("searchExcerpt", () => {
  it("대소문자와 공백 차이를 무시하고 일치한 곳을 나눈다", () => {
    expect(searchExcerpt("축제 부스 배치 초안", "부스배치")).toEqual({
      before: "축제 ",
      match: "부스 배치",
      after: " 초안",
    });
    expect(searchExcerpt("Hello World", "o w")).toEqual({
      before: "Hell",
      match: "o W",
      after: "orld",
    });
  });

  it("일치한 곳이 뒤쪽이면 앞을 줄인다", () => {
    const body = `${"가".repeat(40)} 찾을말 끝`;
    const { before, match } = searchExcerpt(body, "찾을말");
    expect(before.startsWith("…")).toBe(true);
    expect(Array.from(before).length).toBeLessThanOrEqual(17);
    expect(match).toBe("찾을말");
  });

  it("정규식 특수문자를 글자 그대로 찾고, 못 찾으면 본문을 그대로 둔다", () => {
    expect(searchExcerpt("가격 (3.5)", "(3.5)").match).toBe("(3.5)");
    expect(searchExcerpt("다른 말", "없는")).toEqual({
      before: "다른 말",
      match: "",
      after: "",
    });
  });
});
