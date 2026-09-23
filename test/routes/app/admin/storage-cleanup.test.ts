import { describe, expect, it } from "vitest";

import { handle } from "~/routes/app/admin/storage-cleanup";

describe("storage cleanup route", () => {
  it("allows touch pull-to-refresh for current cleanup status", () => {
    expect(handle.chrome.pullToRefresh).toBe(true);
  });
});
