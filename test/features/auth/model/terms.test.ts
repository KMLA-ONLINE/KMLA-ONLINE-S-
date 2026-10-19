import { describe, expect, it } from "vitest";

import { needsTermsAgreement } from "~/features/auth/model/terms";

describe("terms agreement", () => {
  it("asks only members without an agreement on record", () => {
    expect(needsTermsAgreement({ terms_agreed_at: null })).toBe(true);
    expect(
      needsTermsAgreement({ terms_agreed_at: "2026-10-20T00:00:00+00:00" }),
    ).toBe(false);
    expect(needsTermsAgreement(null)).toBe(false);
  });
});
