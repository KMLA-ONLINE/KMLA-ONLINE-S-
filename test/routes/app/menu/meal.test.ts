import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMealDay: vi.fn(),
  getMealDayIfLoaded: vi.fn(),
}));

vi.mock("~/features/meal", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getMealDay: mocks.getMealDay,
  getMealDayIfLoaded: mocks.getMealDayIfLoaded,
}));

import { clientLoader } from "~/routes/app/menu/meal";

describe("meal loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMealDayIfLoaded.mockReturnValue(undefined);
  });

  // NEIS는 외부 API라 느리다. 날짜 줄과 끼니 탭은 기다리지 않고 그린다.
  it("hands the first day over without waiting for NEIS", () => {
    const pending = new Promise(() => undefined);
    mocks.getMealDay.mockReturnValue(pending);

    const loaded = clientLoader();

    expect(loaded.dates).toHaveLength(7);
    expect(loaded.dates).toContain(loaded.initialDate);
    expect(mocks.getMealDay).toHaveBeenCalledWith(loaded.initialDate);
    expect(loaded.initialDay).toBe(pending);
  });

  it("hands over a day it already has as a value", () => {
    const day = { date: "20261012", meals: [], unavailable: false };
    mocks.getMealDayIfLoaded.mockReturnValue(day);

    expect(clientLoader().initialDay).toBe(day);
  });
});
