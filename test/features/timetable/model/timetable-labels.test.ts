import { describe, expect, it } from "vitest";

import {
  periodLabel,
  weekdayLabel,
} from "~/features/timetable/model/timetable";

describe("timetable labels", () => {
  it("defaults to Korean weekday and period labels", () => {
    expect(weekdayLabel(0)).toBe("월");
    expect(weekdayLabel(4, "ko", "long")).toBe("금요일");
    expect(periodLabel(3)).toBe("3교시");
  });

  it("gives English labels for the English locale", () => {
    expect(weekdayLabel(0, "en")).toBe("Mon");
    expect(weekdayLabel(2, "en", "long")).toBe("Wednesday");
    expect(periodLabel(3, "en")).toBe("Period 3");
  });
});
