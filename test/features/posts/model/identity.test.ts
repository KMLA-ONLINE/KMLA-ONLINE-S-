import { describe, expect, it } from "vitest";

import { resolveIdentityOptions } from "~/features/posts/model/identity";

describe("resolveIdentityOptions", () => {
  it("derives the writable identities from policy and role", () => {
    expect(resolveIdentityOptions("identified", "member")).toEqual([
      "identified",
    ]);
    expect(resolveIdentityOptions("optional_anonymous", "member")).toEqual([
      "identified",
      "anonymous",
    ]);
    expect(resolveIdentityOptions("optional_anonymous", "manager")).toEqual([
      "identified",
      "anonymous",
      "staff",
    ]);
    // 운영진 명의는 역할에서만 나온다 — 익명을 막은 그룹에도 그대로 붙는다.
    expect(resolveIdentityOptions("identified", "owner")).toEqual([
      "identified",
      "staff",
    ]);
  });

  it("removes anonymous while the caller has an active restriction", () => {
    expect(
      resolveIdentityOptions("optional_anonymous", "manager", true),
    ).toEqual(["identified", "staff"]);
  });
});
