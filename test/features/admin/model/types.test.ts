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

  it("tells the admin when another admin already handled the application", () => {
    expect(
      getAdminErrorMessage({
        code: "55000",
        message: "pending application not found",
      }),
    ).toBe("이미 처리된 신청입니다. 목록을 새로고침해 주세요.");
  });

  it("gives the final-admin invariant a useful message", () => {
    expect(
      getAdminErrorMessage({
        code: "55000",
        message: "the final app administrator cannot be demoted",
      }),
    ).toBe("마지막 앱 관리자는 강등할 수 없습니다.");
  });

  it("학교 공지 동기화 설정과 계정 입력 오류를 안내한다", () => {
    expect(
      getAdminErrorMessage({
        code: "55000",
        message: "school notice sync vault configuration is missing",
      }),
    ).toBe("동기화 설정(Vault)이 없어 실행하지 못했습니다.");
    expect(
      getAdminErrorMessage({
        code: "22023",
        message: "school id must be 1 to 100 characters",
      }),
    ).toBe("학교 아이디를 입력해 주세요.");
    expect(
      getAdminErrorMessage({
        code: "22023",
        message: "school password must be 1 to 200 characters",
      }),
    ).toBe("학교 비밀번호를 입력해 주세요.");
  });
});
