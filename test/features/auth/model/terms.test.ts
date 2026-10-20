import { describe, expect, it } from "vitest";

import {
  formatTermsDate,
  needsTermsAgreement,
  TERMS_VERSION,
} from "~/features/auth/model/terms";
import termsOfService from "../../../../docs/legal/terms_of_service.md?raw";
import identitySchema from "../../../../supabase/schemas/11-identity.sql?raw";

describe("terms agreement", () => {
  it("asks only members without an agreement on record", () => {
    expect(needsTermsAgreement({ terms_agreed_at: null })).toBe(true);
    expect(
      needsTermsAgreement({ terms_agreed_at: "2026-10-20T00:00:00+00:00" }),
    ).toBe(false);
    expect(needsTermsAgreement(null)).toBe(false);
  });

  it("writes a date the way the legal documents do", () => {
    expect(formatTermsDate("2026-10-20")).toBe("2026년 10월 20일");
    expect(formatTermsDate("2027-03-01")).toBe("2027년 3월 1일");
  });

  // 약관 판은 원문의 시행일이고, 앱과 DB가 같은 값을 따로 들고 있다. 개정 때 한 곳만 바꾸면
  // 가입 신청과 동의 기록이 모두 거절된다.
  it("keeps the version in step with the terms document and the database", () => {
    const date = formatTermsDate(TERMS_VERSION);

    expect(termsOfService).toContain(`시행일: ${date}`);
    expect(termsOfService).toContain(`이 약관은 ${date}부터 시행합니다.`);
    expect(identitySchema).toMatch(
      new RegExp(
        `"current_terms_version"\\(\\)[\\s\\S]*?select date '${TERMS_VERSION}';`,
      ),
    );
  });
});
