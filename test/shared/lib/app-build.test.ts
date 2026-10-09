import { describe, expect, it } from "vitest";

import { formatAppBuild } from "~/shared/lib/app-build";

describe("formatAppBuild", () => {
  it("shows the Korean build date and the short commit", () => {
    // 한국 시각으로는 이미 다음 날이다.
    expect(
      formatAppBuild({ commit: "0c3a00a", builtAt: "2026-10-08T16:30:00Z" }),
    ).toBe("2026.10.09 · 0c3a00a");
  });

  it("falls back to the date alone, then to an unknown build", () => {
    expect(
      formatAppBuild({ commit: null, builtAt: "2026-10-09T03:00:00Z" }),
    ).toBe("2026.10.09");
    expect(formatAppBuild(null)).toBe("알 수 없음");
  });
});
