import { describe, expect, it } from "vitest";

import { resolveIdentityOptions } from "~/features/posts/model/identity";

describe("resolveIdentityOptions", () => {
  it("keeps identified groups identified-only", () => {
    expect(resolveIdentityOptions("identified", "member")).toEqual([
      "identified",
    ]);
  });

  it("keeps anonymous posting optional", () => {
    expect(resolveIdentityOptions("optional_anonymous", "member")).toEqual([
      "identified",
      "anonymous",
    ]);
  });

  it("adds the staff identity for group staff", () => {
    expect(resolveIdentityOptions("optional_anonymous", "manager")).toEqual([
      "identified",
      "anonymous",
      "staff",
    ]);
  });
});
