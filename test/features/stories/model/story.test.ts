import { describe, expect, it } from "vitest";

import {
  findAuthorJump,
  groupStoriesByAuthor,
  isStoryContentValid,
  normalizeStoryLink,
  readStoryGesture,
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
    expect(normalizeStoryLink("web.archive.org/web/https://kmla.kr")).toBe(
      "https://web.archive.org/web/https://kmla.kr",
    );
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

describe("readStoryGesture", () => {
  const width = 300;

  it("pages within the author on a short, still tap", () => {
    expect(
      readStoryGesture({ dx: 2, dy: 3, durationMs: 120, x: 50, width }),
    ).toEqual({ kind: "tap", side: "previous" });
    expect(
      readStoryGesture({ dx: 0, dy: 0, durationMs: 120, x: 200, width }),
    ).toEqual({ kind: "tap", side: "next" });
  });

  it("jumps to another author on a quick horizontal swipe instead of paging", () => {
    expect(
      readStoryGesture({ dx: -90, dy: 10, durationMs: 120, x: 200, width }),
    ).toEqual({ kind: "author", direction: "next" });
    expect(
      readStoryGesture({ dx: 90, dy: -10, durationMs: 400, x: 50, width }),
    ).toEqual({ kind: "author", direction: "previous" });
  });

  it("closes on a vertical swipe", () => {
    expect(
      readStoryGesture({ dx: 20, dy: 120, durationMs: 200, x: 200, width }),
    ).toEqual({ kind: "close" });
  });

  it("does nothing after a hold or a swipe too short to count", () => {
    expect(
      readStoryGesture({ dx: 0, dy: 0, durationMs: 600, x: 200, width }),
    ).toEqual({ kind: "none" });
    expect(
      readStoryGesture({ dx: -30, dy: 0, durationMs: 120, x: 200, width }),
    ).toEqual({ kind: "none" });
  });
});

describe("findAuthorJump", () => {
  const groups = [
    { pubId: "me", stories: [{ pubId: "me", id: 1 }] },
    {
      pubId: "a",
      stories: [
        { pubId: "a", id: 2 },
        { pubId: "a", id: 3 },
      ],
    },
    { pubId: "b", stories: [{ pubId: "b", id: 4 }] },
  ];

  it("lands on the first story of the neighbouring author", () => {
    expect(findAuthorJump(groups, 0, "next")).toEqual({ kind: "show", id: 2 });
    expect(findAuthorJump(groups, 2, "previous")).toEqual({
      kind: "show",
      id: 2,
    });
  });

  it("closes past the last author and stays put before the first", () => {
    expect(findAuthorJump(groups, 2, "next")).toEqual({ kind: "close" });
    expect(findAuthorJump(groups, 0, "previous")).toEqual({ kind: "stay" });
  });
});
