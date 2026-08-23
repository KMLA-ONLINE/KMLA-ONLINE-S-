import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  calendarWeekday,
  koreaTodayKey,
  startOfKoreaWeek,
} from "~/features/school-utilities/model/korea-date";

describe("Korea booking calendar", () => {
  it("switches weeks exactly at Korea midnight", () => {
    const beforeMonday = new Date("2026-08-23T14:59:59Z");
    const monday = new Date("2026-08-23T15:00:00Z");

    expect(koreaTodayKey(beforeMonday)).toBe("2026-08-23");
    expect(startOfKoreaWeek(koreaTodayKey(beforeMonday))).toBe("2026-08-17");
    expect(koreaTodayKey(monday)).toBe("2026-08-24");
    expect(startOfKoreaWeek(koreaTodayKey(monday))).toBe("2026-08-24");
  });

  it("uses stable calendar arithmetic independent of the browser timezone", () => {
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(calendarWeekday("2026-08-23")).toBe(0);
    expect(calendarWeekday("2026-08-24")).toBe(1);
  });
});
