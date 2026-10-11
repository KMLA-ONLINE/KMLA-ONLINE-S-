import { describe, expect, it } from "vitest";

import { handle } from "~/routes/app/admin/approvals";

describe("admin approvals route", () => {
  it("allows touch pull-to-refresh for newly submitted applications", () => {
    expect(handle.chrome.pullToRefresh).toBe(true);
  });
});
