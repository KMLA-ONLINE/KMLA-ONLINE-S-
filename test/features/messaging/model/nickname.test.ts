import { describe, expect, it } from "vitest";

import { nicknameProblem } from "~/features/messaging/model/nickname";

describe("nicknameProblem", () => {
  it("빈 값은 지우기라 문제가 아니고, 20자까지 받는다", () => {
    expect(nicknameProblem("")).toBeNull();
    expect(nicknameProblem("가".repeat(20))).toBeNull();
    expect(nicknameProblem("가".repeat(21))).toBe("too_long");
  });

  it("이모지는 한 글자로 센다", () => {
    expect(nicknameProblem("😀".repeat(20))).toBeNull();
  });

  it("보이지 않는 글자나 공백만 있는 별명은 받지 않는다", () => {
    expect(nicknameProblem(String.fromCodePoint(0x3164))).toBe("invisible");
    expect(nicknameProblem(`준${String.fromCodePoint(0x202e)}이`)).toBe(
      "invisible",
    );
    expect(nicknameProblem(`준${String.fromCodePoint(0x200b)}`)).toBe(
      "invisible",
    );
    expect(nicknameProblem(String.fromCodePoint(0x2003))).toBe("invisible");
    expect(nicknameProblem("준 이")).toBeNull();
  });
});
