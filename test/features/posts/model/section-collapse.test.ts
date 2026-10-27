import { beforeEach, describe, expect, it } from "vitest";

import {
  readGroupSectionCollapsed,
  writeGroupSectionCollapsed,
} from "~/features/posts/model/section-collapse";

describe("group section collapse preference", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to expanded and remembers each group's sections on this device", () => {
    expect(readGroupSectionCollapsed("group-a", "featured")).toBe(false);
    writeGroupSectionCollapsed("group-a", "featured", true);
    expect(readGroupSectionCollapsed("group-a", "featured")).toBe(true);
    expect(readGroupSectionCollapsed("group-a", "pinned")).toBe(false);
    expect(readGroupSectionCollapsed("group-b", "featured")).toBe(false);
    expect(
      JSON.parse(
        window.localStorage.getItem("kmla-online:group-sections:v1") ?? "{}",
      ),
    ).toEqual({ "group-a": { featured: true } });
  });

  it("drops a group entry once every section is expanded again", () => {
    writeGroupSectionCollapsed("group-a", "pinned", true);
    writeGroupSectionCollapsed("group-a", "pinned", false);
    expect(window.localStorage.getItem("kmla-online:group-sections:v1")).toBe(
      null,
    );
  });

  it("falls back to expanded when storage holds garbage", () => {
    window.localStorage.setItem("kmla-online:group-sections:v1", "{oops");
    expect(readGroupSectionCollapsed("group-a", "featured")).toBe(false);
    window.localStorage.setItem(
      "kmla-online:group-sections:v1",
      JSON.stringify({ "group-a": { featured: "yes" } }),
    );
    expect(readGroupSectionCollapsed("group-a", "featured")).toBe(false);
    writeGroupSectionCollapsed("group-a", "featured", false);
    expect(window.localStorage.getItem("kmla-online:group-sections:v1")).toBe(
      null,
    );
  });
});
