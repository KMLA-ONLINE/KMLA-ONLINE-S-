import { describe, expect, it } from "vitest";

import { formatAbsoluteTime, formatRelativeTime } from "~/shared/lib/time";

const NOW = Date.parse("2026-08-09T12:00:00.000Z");

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe("formatRelativeTime", () => {
  it("경계마다 단위를 바꾼다", () => {
    expect(formatRelativeTime(ago(30_000), NOW)).toBe("방금");
    expect(formatRelativeTime(ago(60_000), NOW)).toBe("1분전");
    expect(formatRelativeTime(ago(59 * 60_000), NOW)).toBe("59분전");
    expect(formatRelativeTime(ago(60 * 60_000), NOW)).toBe("1시간전");
    expect(formatRelativeTime(ago(24 * 3_600_000), NOW)).toBe("1일전");
  });

  it("미래 시각은 음수로 새지 않고 '방금'으로 눌러 담는다", () => {
    expect(formatRelativeTime(ago(-60_000), NOW)).toBe("방금");
  });

  it("파싱할 수 없으면 null이다", () => {
    // 가드가 없으면 "NaN일전"이 화면에 나간다.
    expect(formatRelativeTime("garbage", NOW)).toBeNull();
    expect(formatRelativeTime("", NOW)).toBeNull();
  });
});

describe("formatAbsoluteTime", () => {
  it("연·월·일·시·분을 한국어로 낸다", () => {
    const formatted = formatAbsoluteTime("2026-08-09T03:05:00.000Z");

    expect(formatted).toContain("2026");
    expect(formatted).toContain("8월");
  });

  it("파싱할 수 없으면 던지지 않고 null이다", () => {
    // `Intl.DateTimeFormat.format(Invalid Date)`는 RangeError를 던져 화면을 죽인다.
    expect(() => formatAbsoluteTime("garbage")).not.toThrow();
    expect(formatAbsoluteTime("garbage")).toBeNull();
  });
});
