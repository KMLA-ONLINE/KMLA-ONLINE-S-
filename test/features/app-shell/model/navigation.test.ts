import { describe, expect, it } from "vitest";

import { isPostOverlayNavigation } from "~/features/app-shell/model/navigation";

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
