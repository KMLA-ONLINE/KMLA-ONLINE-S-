import { describe, expect, it } from "vitest";

import {
  groupStoriesByAuthor,
  isStoryContentValid,
  normalizeStoryLink,
} from "~/features/stories/model/story";

describe("story content", () => {
  it("requires text only for a text story", () => {
    expect(isStoryContentValid("   ", { required: true })).toBe(false);
    expect(isStoryContentValid("   ", { required: false })).toBe(true);
    expect(isStoryContentValid("가".repeat(101), { required: false })).toBe(
      false,
    );
  });
});

describe("normalizeStoryLink", () => {
  it("treats an empty field as no link and adds https to a bare host", () => {
    expect(normalizeStoryLink("  ")).toBeNull();
    expect(normalizeStoryLink("kmla.kr/notice")).toBe("https://kmla.kr/notice");
    expect(normalizeStoryLink("kmla.kr:8080/a")).toBe("https://kmla.kr:8080/a");
  });

  it("lowercases the scheme so the database check accepts it", () => {
    expect(normalizeStoryLink("HTTPS://Example.com")).toBe(
      "https://example.com/",
    );
  });

  it("rejects links the database would refuse", () => {
    expect(normalizeStoryLink("javascript:alert(1)")).toBeUndefined();
    expect(normalizeStoryLink("https://kmla.kr/a b")).toBeUndefined();
    expect(normalizeStoryLink("mailto:a@kmla.kr")).toBeUndefined();
  });
});

describe("groupStoriesByAuthor", () => {
  it("keeps RPC order but moves the viewer's group first", () => {
    const groups = groupStoriesByAuthor(
      [
        { pubId: "a", id: 1 },
        { pubId: "a", id: 2 },
        { pubId: "me", id: 3 },
        { pubId: "b", id: 4 },
      ],
      "me",
    );

    expect(groups.map((group) => group.pubId)).toEqual(["me", "a", "b"]);
    expect(groups[1]?.stories.map((story) => story.id)).toEqual([1, 2]);
  });
});
