import { describe, expect, it } from "vitest";

import {
  isPostOverlayNavigation,
  isSamePathUiOverlayNavigation,
  isTabReselectClick,
} from "~/features/app-shell/model/navigation";

describe("isPostOverlayNavigation", () => {
  it.each([
    ["/groups/study", "/groups/study/posts/post-id"],
    ["/groups/study/posts/post-id", "/groups/study"],
    ["/profile/jieun-29", "/profile/jieun-29/posts/post-id"],
    ["/profile/jieun-29/posts/post-id", "/profile/jieun-29"],
  ])("preserves the parent while navigating from %s to %s", (current, next) => {
    expect(isPostOverlayNavigation(current, next)).toBe(true);
  });

  it.each([
    ["/groups/study", "/groups/other/posts/post-id"],
    ["/groups/study", "/groups/study/posts/new"],
    ["/groups/study/posts/post-id", "/groups/study/posts/post-id/edit"],
    ["/profile/jieun-29", "/menu"],
  ])("keeps normal navigation from %s to %s", (current, next) => {
    expect(isPostOverlayNavigation(current, next)).toBe(false);
  });
});

describe("isSamePathUiOverlayNavigation", () => {
  it.each([
    ["/groups/study/posts/post-id", "", "?image=attachment-id"],
    [
      "/groups/study/posts/post-id",
      "?image=attachment-id",
      "?view=comments&image=attachment-id",
    ],
    ["/profile/jieun-29/posts/post-id", "?view=comments", ""],
    ["/groups/study/posts/post-id", "", "?reactions=comment%3Ac1"],
  ])(
    "preserves the outlet for UI-only search navigation",
    (path, current, next) => {
      expect(isSamePathUiOverlayNavigation(path, current, path, next)).toBe(
        true,
      );
    },
  );

  it.each([
    [
      "/groups/study/posts/post-id",
      "",
      "/groups/study",
      "?image=attachment-id",
    ],
    [
      "/groups/study/posts/post-id",
      "?image=attachment-id",
      "/groups/study/posts/post-id",
      "?image=attachment-id&filter=recent",
    ],
    ["/groups/study/posts/post-id", "?image=attachment-id", "/menu", ""],
  ])(
    "keeps normal navigation pending",
    (currentPath, currentSearch, nextPath, nextSearch) => {
      expect(
        isSamePathUiOverlayNavigation(
          currentPath,
          currentSearch,
          nextPath,
          nextSearch,
        ),
      ).toBe(false);
    },
  );
});

describe("isTabReselectClick", () => {
  const plainClick = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };
  const home = { pathname: "/", search: "", hash: "" };

  it("accepts a plain click on the tab's first screen", () => {
    expect(isTabReselectClick(plainClick, home, "/")).toBe(true);
  });

  it.each([
    ["another tab", { ...home, pathname: "/groups" }],
    ["an overlay query", { ...home, search: "?post=1" }],
    ["a hash", { ...home, hash: "#top" }],
  ])("rejects a click while on %s", (_, location) => {
    expect(isTabReselectClick(plainClick, location, "/")).toBe(false);
  });

  it.each([
    ["middle button", { button: 1 }],
    ["meta", { metaKey: true }],
    ["ctrl", { ctrlKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
  ])("leaves a %s click to the browser", (_, modifier) => {
    expect(isTabReselectClick({ ...plainClick, ...modifier }, home, "/")).toBe(
      false,
    );
  });
});
