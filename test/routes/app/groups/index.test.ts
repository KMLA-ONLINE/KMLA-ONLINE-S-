import { describe, expect, it } from "vitest";

import { shouldRevalidate } from "~/routes/app/groups/index";

describe("group home revalidation", () => {
  it("does not reload data for the client-side tab", () => {
    expect(
      shouldRevalidate({
        currentUrl: new URL("https://example.com/groups?tab=official"),
        nextUrl: new URL("https://example.com/groups?tab=unofficial"),
      } as never),
    ).toBe(false);
  });

  it("allows explicit same-url refreshes", () => {
    const url = new URL("https://example.com/groups");
    expect(shouldRevalidate({ currentUrl: url, nextUrl: url } as never)).toBe(
      true,
    );
  });
});
