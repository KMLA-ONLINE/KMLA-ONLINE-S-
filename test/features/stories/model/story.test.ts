import { describe, expect, it } from "vitest";

import {
  isStoryContentValid,
  normalizeStoryContent,
} from "~/features/stories/model/story";

describe("story content", () => {
  it("accepts 2 to 100 characters after trimming", () => {
    expect(normalizeStoryContent("  오늘 급식 최고  ")).toBe("오늘 급식 최고");
    expect(isStoryContentValid("1")).toBe(false);
    expect(isStoryContentValid("12")).toBe(true);
    expect(isStoryContentValid("가".repeat(100))).toBe(true);
    expect(isStoryContentValid("가".repeat(101))).toBe(false);
    // 길이는 다듬은 뒤에 센다 — 한 글자를 공백으로 늘려도 통과하면 안 된다.
    expect(isStoryContentValid("  1  ")).toBe(false);
  });

  it("rejects an empty story because the text is the whole record", () => {
    // 구분을 없앤 뒤로는 글이 곧 스토리다. 빈 글은 남길 것이 없다(기능 명세 §17.6).
    expect(isStoryContentValid("")).toBe(false);
    expect(isStoryContentValid("   ")).toBe(false);
  });
});
