import { describe, expect, it } from "vitest";

import { hasMinimumSearchLength } from "~/features/search/model/format";

describe("hasMinimumSearchLength", () => {
  it("rejects fewer than two characters after trimming", () => {
    expect(hasMinimumSearchLength("")).toBe(false);
    expect(hasMinimumSearchLength(" 김 ")).toBe(false);
  });

  it("accepts two or more characters", () => {
    expect(hasMinimumSearchLength("김민")).toBe(true);
  });
});
