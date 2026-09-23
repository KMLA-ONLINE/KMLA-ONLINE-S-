import { describe, expect, it } from "vitest";

import {
  hasMinimumGroupSearchLength,
  normalizeGroupSearchInput,
} from "~/features/groups/model/format";

describe("group search input", () => {
  it("accepts a one-character Korean group name", () => {
    expect(hasMinimumGroupSearchLength("한")).toBe(true);
    expect(hasMinimumGroupSearchLength("한글")).toBe(true);
  });

  it("normalizes composed Korean and surrounding whitespace", () => {
    expect(normalizeGroupSearchInput("  한글  ")).toBe("한글");
    expect(hasMinimumGroupSearchLength("  한  ")).toBe(true);
  });
});
