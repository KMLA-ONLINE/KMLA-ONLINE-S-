import { describe, expect, it } from "vitest";

import { formatBadgeCount } from "~/features/app-shell/model/badges";

describe("formatBadgeCount", () => {
  it("0 이하는 뱃지를 붙이지 않는다", () => {
    expect(formatBadgeCount(0)).toBeNull();
    expect(formatBadgeCount(-3)).toBeNull();
  });

  it("99까지는 숫자 그대로, 넘으면 99+로 줄인다", () => {
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(99)).toBe("99");
    expect(formatBadgeCount(100)).toBe("99+");
  });
});
