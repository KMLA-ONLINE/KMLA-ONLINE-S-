import { describe, expect, it } from "vitest";

import {
  isStoryContentValid,
  normalizeStoryContent,
} from "~/features/stories/model/story";

describe("story content", () => {
  it("accepts up to 100 characters after trimming", () => {
    expect(normalizeStoryContent("  오늘 급식 최고  ")).toBe("오늘 급식 최고");
    expect(isStoryContentValid("1")).toBe(true);
    expect(isStoryContentValid("가".repeat(100))).toBe(true);
    expect(isStoryContentValid("가".repeat(101))).toBe(false);
    expect(isStoryContentValid("  1  ")).toBe(true);
  });

  it("accepts an empty story", () => {
    expect(isStoryContentValid("")).toBe(true);
    expect(isStoryContentValid("   ")).toBe(true);
  });
});
