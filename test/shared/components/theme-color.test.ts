import { describe, expect, it } from "vitest";

import { isTransparent } from "~/shared/components/theme-color";

describe("isTransparent", () => {
  it.each([
    "rgba(0, 0, 0, 0)",
    "rgba(255, 255, 255, 0)",
    "rgb(0 0 0 / 0)",
    "rgba(12, 40, 9, 0.0)",
    "transparent",
  ])("treats %s as transparent", (color) => {
    expect(isTransparent(color)).toBe(true);
  });

  it.each([
    // 알파가 없는 표기는 불투명이다. 마지막 채널이 0이라고 투명이 아니다 — 이걸
    // 문자열 끝으로 판정하면 순수 검정 배경에서 theme-color가 갱신되지 않는다.
    "rgb(0, 0, 0)",
    "rgb(12, 40, 0)",
    "rgb(255, 255, 255)",
    "rgba(0, 0, 0, 1)",
    "rgba(34, 34, 40, 0.5)",
    "rgb(0 0 0 / 1)",
  ])("treats %s as opaque", (color) => {
    expect(isTransparent(color)).toBe(false);
  });

  it.each(["", "oklch(0.22 0.006 264)", "#000000"])(
    "does not claim %s is transparent",
    (color) => {
      expect(isTransparent(color)).toBe(false);
    },
  );
});
