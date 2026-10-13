import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readHomeSidebarPreferences,
  writeHomeSidebarPreferences,
} from "~/features/app-shell/storage/home-sidebar-preferences";

const ALL_VISIBLE = {
  enabled: true,
  birthdays: true,
  meal: true,
  timetable: true,
};

describe("home sidebar preferences", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("shows everything when nothing is stored", () => {
    expect(readHomeSidebarPreferences()).toEqual(ALL_VISIBLE);
  });

  it("keeps stored choices and shows anything missing or malformed", () => {
    window.localStorage.setItem(
      "kmla-online:home-sidebar:v1",
      JSON.stringify({ meal: false, timetable: "no", extra: false }),
    );

    expect(readHomeSidebarPreferences()).toEqual({
      ...ALL_VISIBLE,
      meal: false,
    });
  });

  it("does not throw when storage rejects the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    expect(() =>
      writeHomeSidebarPreferences({ ...ALL_VISIBLE, meal: false }),
    ).not.toThrow();
  });
});
