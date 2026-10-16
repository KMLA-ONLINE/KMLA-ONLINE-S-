import { describe, expect, it } from "vitest";

import {
  getGroupErrorMessage,
  hasMinimumGroupSearchLength,
  normalizeGroupSearchInput,
} from "~/features/groups/model/format";

describe("group invite errors", () => {
  it("explains an unavailable invite without changing other missing-resource errors", () => {
    expect(
      getGroupErrorMessage({ code: "P0002", message: "invite not found" }),
    ).toBe("사용할 수 없는 초대 링크입니다.");
    expect(
      getGroupErrorMessage({ code: "P0002", message: "group not found" }),
    ).toBe("그룹을 찾을 수 없습니다.");
  });
});

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
