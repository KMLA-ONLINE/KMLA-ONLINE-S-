import { describe, expect, it } from "vitest";

import { groupKeys, isGroupAccessQuery } from "~/features/groups/data/cache";

describe("group query keys", () => {
  it("separates discovery filters and cursors", () => {
    const first = groupKeys.discovery("사진", false, null);
    const joined = groupKeys.discovery("사진", true, null);
    const next = groupKeys.discovery("사진", false, {
      rank: 1,
      memberCount: 20,
      groupId: "group-id",
    });

    expect(first).not.toEqual(joined);
    expect(first).not.toEqual(next);
  });

  it("keeps every group query under the common root", () => {
    expect(groupKeys.home()[0]).toBe("groups");
    expect(groupKeys.detail("slug")[0]).toBe("groups");
    expect(groupKeys.posts("group-id", null, null)[0]).toBe("groups");
  });

  it("identifies protected queries for one group", () => {
    expect(
      isGroupAccessQuery(
        groupKeys.posts("group-id", null, null),
        "group-id",
        "slug",
      ),
    ).toBe(true);
    expect(
      isGroupAccessQuery(groupKeys.detail("slug"), "group-id", "slug"),
    ).toBe(true);
    expect(
      isGroupAccessQuery(
        groupKeys.posts("other", null, null),
        "group-id",
        "slug",
      ),
    ).toBe(false);
    expect(isGroupAccessQuery(groupKeys.home(), "group-id", "slug")).toBe(
      false,
    );
  });
});
