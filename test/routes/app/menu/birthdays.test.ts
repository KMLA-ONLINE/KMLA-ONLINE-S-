import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listBirthdayCalendar: vi.fn(),
}));

vi.mock("~/features/profiles", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listBirthdayCalendar: mocks.listBirthdayCalendar,
}));

vi.mock("~/shared/lib/korea-date", () => ({
  getKoreaDateIso: () => "2026-12-30",
}));

import { clientLoader } from "~/routes/app/menu/birthdays";
import {
  getQueryClient,
  resetQueryClientForTests,
} from "~/shared/lib/query-client";

describe("birthday calendar loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryClientForTests();
    mocks.listBirthdayCalendar.mockResolvedValue([]);
  });

  it("loads one annual birthday cycle into the query cache", async () => {
    const result = await clientLoader();

    expect(mocks.listBirthdayCalendar).toHaveBeenCalledWith("2026-12-30");
    expect(result).toEqual({ birthdays: [], referenceDate: "2026-12-30" });
    expect(
      getQueryClient().getQueryData(["birthdays", "year", "2026-12-30"]),
    ).toEqual([]);
  });
});
