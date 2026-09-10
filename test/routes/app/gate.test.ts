import { describe, expect, it } from "vitest";

import { shouldRevalidate } from "~/routes/app/gate";

describe("app gate revalidation", () => {
  it("does not reload the profile for an explicit child-route refresh", () => {
    const url = new URL("https://example.com/groups/private-club?tab=members");

    expect(shouldRevalidate({ currentUrl: url, nextUrl: url } as never)).toBe(
      false,
    );
  });

  it("reloads the profile after a mutation", () => {
    const url = new URL("https://example.com/groups/private-club");

    expect(
      shouldRevalidate({
        currentUrl: url,
        nextUrl: url,
        formMethod: "POST",
      } as never),
    ).toBe(true);
  });
});
