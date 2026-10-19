import { describe, expect, it } from "vitest";

import {
  COLORS,
  COLOR_DOTS,
  COLOR_SHADES,
} from "~/features/timetable/model/timetable";

describe("timetable course colors", () => {
  it("keeps saved preset indexes and offers multiple shades for each preset", () => {
    expect(COLORS[0]).toBe("bg-rose-400 text-black");
    expect(COLORS[9]).toBe("bg-gray-400 text-black");
    expect(COLOR_SHADES).toHaveLength(COLOR_DOTS.length);
    for (const [preset, shades] of COLOR_SHADES.entries()) {
      expect(shades).toHaveLength(5);
      expect(shades).toContain(preset);
      expect(new Set(shades.map((index) => COLORS[index])).size).toBe(5);
    }
  });
});
