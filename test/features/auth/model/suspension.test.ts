import { describe, expect, it } from "vitest";

import { describeSuspensionEnd } from "~/features/auth/model/suspension";

const NOW = Date.parse("2026-10-16T12:00:00Z");

describe("describeSuspensionEnd", () => {
  it("returns nothing for an indefinite suspension", () => {
    expect(describeSuspensionEnd(null, NOW)).toBeNull();
  });

  // UTC로는 16일 15:00이지만 한국 시간으로는 17일 00:00이다.
  it("shows the end time in Korea time", () => {
    expect(describeSuspensionEnd("2026-10-23T15:00:00Z", NOW)?.label).toBe(
      "2026년 10월 24일 00:00",
    );
    expect(describeSuspensionEnd("2026-10-23T12:05:00Z", NOW)?.label).toBe(
      "2026년 10월 23일 21:05",
    );
  });

  it("rounds the remaining days up", () => {
    expect(
      describeSuspensionEnd("2026-10-23T12:00:00Z", NOW)?.remainingDays,
    ).toBe(7);
    expect(
      describeSuspensionEnd("2026-10-23T12:00:01Z", NOW)?.remainingDays,
    ).toBe(8);
    expect(
      describeSuspensionEnd("2026-10-16T12:30:00Z", NOW)?.remainingDays,
    ).toBe(1);
  });

  // 화면을 열어 둔 채 해제 시각이 지나면 남은 기간이 없다. 하루로 올려 보이면 안 된다.
  it("reports no remaining days once the end has passed", () => {
    expect(
      describeSuspensionEnd("2026-10-16T11:59:00Z", NOW)?.remainingDays,
    ).toBe(0);
  });
});
