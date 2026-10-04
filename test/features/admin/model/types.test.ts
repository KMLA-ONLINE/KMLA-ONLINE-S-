import { describe, expect, it } from "vitest";

import {
  getAdminErrorMessage,
  isAdminAccessError,
  isRecentAdminAuthError,
  normalizeAdminSearch,
} from "~/features/admin/model/types";

describe("admin model", () => {
  it("requires two trimmed characters before searching", () => {
    expect(normalizeAdminSearch(" 가 ")).toBe("");
    expect(normalizeAdminSearch(" 홍길 ")).toBe("홍길");
  });

  it("separates reauthentication from ordinary authorization failures", () => {
    const recent = {
      code: "42501",
      message: "recent password authentication required",
    };
    const forbidden = { code: "42501", message: "app administrator required" };

    expect(isRecentAdminAuthError(recent)).toBe(true);
    expect(isAdminAccessError(recent)).toBe(false);
    expect(isAdminAccessError(forbidden)).toBe(true);
  });

  it("gives the final-admin invariant a useful message", () => {
    expect(
      getAdminErrorMessage({
        code: "55000",
        message: "the final app administrator cannot be demoted",
      }),
    ).toBe("마지막 앱 관리자는 강등할 수 없습니다.");
  });
});
