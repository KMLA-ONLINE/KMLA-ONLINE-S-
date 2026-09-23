import { describe, expect, it } from "vitest";

import { resolveBackStack } from "~/shared/lib/back-stack";

describe("back stack", () => {
  it("puts the group and its list under a group post", () => {
    expect(resolveBackStack("/groups/study/posts/post-id")).toEqual([
      "/",
      "/groups",
      "/groups/study",
    ]);
  });

  /**
   * 부모를 경로 수술로 뽑으면 안 된다는 것을 고정한다. `/profile/:pubId`에서 한 칸 떼면 나오는
   * `/profile`은 그 사람 화면의 상위가 아니라 "내 프로필"이므로, 프로필 게시물의 뒤로가기는
   * 그 사람 타임라인 다음 곧장 홈이어야 한다.
   */
  it("never routes a profile through the viewer's own profile", () => {
    expect(resolveBackStack("/profile/pub-1/posts/post-id")).toEqual([
      "/",
      "/profile/pub-1",
    ]);
    expect(resolveBackStack("/profile/pub-1")).toEqual(["/"]);
  });

  it("puts only home under a top-level screen", () => {
    expect(resolveBackStack("/groups/study")).toEqual(["/", "/groups"]);
    expect(resolveBackStack("/noti")).toEqual(["/"]);
    expect(resolveBackStack("/util/gongang")).toEqual(["/"]);
  });

  it("falls back to home for a screen the table does not declare", () => {
    expect(resolveBackStack("/menu/meal")).toEqual(["/"]);
  });

  it("has nothing to put under home itself", () => {
    expect(resolveBackStack("/")).toEqual([]);
  });

  it("ignores the query and hash when matching", () => {
    expect(
      resolveBackStack("/groups/study/posts/post-id?from=push#c1"),
    ).toEqual(["/", "/groups", "/groups/study"]);
  });
});
