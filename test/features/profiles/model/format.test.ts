import { describe, expect, it } from "vitest";

import { formatCohort } from "~/features/profiles/model/format";

describe("formatCohort", () => {
  it("defaults to Korean and marks returning students with .5", () => {
    expect(formatCohort(25, false)).toBe("25기");
    expect(formatCohort(25, true)).toBe("25.5기");
    expect(formatCohort(null, false)).toBeNull();
  });

  it("spells the cohort out in English", () => {
    expect(formatCohort(25, false, "en")).toBe("Cohort 25");
    expect(formatCohort(25, true, "en")).toBe("Cohort 25.5");
  });
});
