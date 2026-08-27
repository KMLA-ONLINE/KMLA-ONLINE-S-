import { describe, expect, it } from "vitest";

import {
  isAbsenceReasonValid,
  normalizeAbsenceReason,
} from "~/features/absences/model/absence";

describe("absence reason", () => {
  it("accepts 2 to 100 characters after trimming", () => {
    expect(normalizeAbsenceReason("  병원 진료 예정  ")).toBe("병원 진료 예정");
    expect(isAbsenceReasonValid("1")).toBe(false);
    expect(isAbsenceReasonValid("12")).toBe(true);
    expect(isAbsenceReasonValid("가".repeat(100))).toBe(true);
    expect(isAbsenceReasonValid("가".repeat(101))).toBe(false);
    // 길이는 다듬은 뒤에 센다 — 공백으로만 채운 사유는 통과하면 안 된다.
    expect(isAbsenceReasonValid("  1  ")).toBe(false);
  });
});
