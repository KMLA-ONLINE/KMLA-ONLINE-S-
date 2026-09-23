import { describe, expect, it } from "vitest";

import {
  isPostOverlayNavigation,
  isSamePathUiOverlayNavigation,
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
