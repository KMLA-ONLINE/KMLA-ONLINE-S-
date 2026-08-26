import { describe, expect, it } from "vitest";

import {
  isAbsenceReasonValid,
  normalizeAbsenceReason,
} from "~/features/absences/model/absence";

describe("absence reason", () => {
  it("trims whitespace", () => {
    expect(normalizeAbsenceReason("  병원 진료 예정  ")).toBe("병원 진료 예정");
  });

  it("requires at least two characters", () => {
    expect(isAbsenceReasonValid("1")).toBe(false);
    expect(isAbsenceReasonValid("12")).toBe(true);
  });

  it("allows at most one hundred characters", () => {
    expect(isAbsenceReasonValid("가".repeat(100))).toBe(true);
    expect(isAbsenceReasonValid("가".repeat(101))).toBe(false);
  });
});
