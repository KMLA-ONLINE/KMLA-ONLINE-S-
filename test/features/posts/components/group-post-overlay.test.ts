import { describe, expect, it } from "vitest";

import { needsPostIdentityConfirmation } from "~/features/posts/components/group-post-overlay";

describe("needsPostIdentityConfirmation", () => {
  it("confirms anonymous and staff identities in ordinary groups", () => {
    expect(needsPostIdentityConfirmation("identified", false)).toBe(false);
    expect(needsPostIdentityConfirmation("anonymous", false)).toBe(true);
    expect(needsPostIdentityConfirmation("staff", false)).toBe(true);
  });

  it("does not confirm anonymous identity in always-anonymous groups", () => {
    expect(needsPostIdentityConfirmation("anonymous", true)).toBe(false);
    expect(needsPostIdentityConfirmation("staff", true)).toBe(true);
  });
});
