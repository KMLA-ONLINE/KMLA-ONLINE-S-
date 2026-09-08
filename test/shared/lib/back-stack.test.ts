import { describe, expect, it } from "vitest";

import {
  resolveBackStack,
  resolveOverlayParent,
} from "~/shared/lib/back-stack";

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

describe("overlay parent", () => {
  it("names the screen a post overlay is opened on top of", () => {
    expect(resolveOverlayParent("/groups/study/posts/post-id")).toBe(
      "/groups/study",
    );
    expect(resolveOverlayParent("/profile/pub-1/posts/post-id")).toBe(
      "/profile/pub-1",
    );
  });

  /**
   * 오버레이가 아닌 화면은 밑에 무엇이 있든 자기 힘으로 그려진다. 여기에 부모를 끼워 넣으면
   * 알림함에서 그룹으로 들어간 사용자의 뒤로가기가 알림함이 아니라 그룹 목록이 된다.
   */
  it("has no parent to insert under a screen that is not an overlay", () => {
    expect(resolveOverlayParent("/groups/study")).toBeNull();
    expect(resolveOverlayParent("/profile/pub-1")).toBeNull();
    expect(resolveOverlayParent("/noti")).toBeNull();
    expect(resolveOverlayParent("/menu/meal")).toBeNull();
  });

  it("ignores the query and hash when matching", () => {
    expect(
      resolveOverlayParent("/groups/study/posts/post-id?from=push#c1"),
    ).toBe("/groups/study");
  });
});
