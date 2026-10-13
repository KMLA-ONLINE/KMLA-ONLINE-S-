import { describe, expect, it } from "vitest";

import { shouldRevalidate } from "~/routes/app/gate";

describe("app gate revalidation", () => {
  // 셸 데이터는 쿼리(`refreshShellProfile()`, 뱃지 쿼리)로 갱신하므로 게이트는 첫 진입에만 돈다.
  it("never reruns the gate after the first load", () => {
    expect(shouldRevalidate()).toBe(false);
  });
});
