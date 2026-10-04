import { beforeEach, describe, expect, it } from "vitest";

import { feedKeys } from "~/features/feed";
import { groupKeys } from "~/features/groups";
import {
  invalidateDeletedGroupPost,
  invalidateGroupPostOrder,
  invalidateSavedGroupPost,
} from "~/routes/app/groups/post-cache";
import {
  getQueryClient,
  resetQueryClientForTests,
} from "~/shared/lib/query-client";

function seedFeed(postIds: string[]) {
  getQueryClient().setQueryData(feedKeys.list(), {
    pages: [{ posts: postIds.map((post_id) => ({ post_id })) }],
    pageParams: [null],
  });
}

function seedGroupPosts() {
  getQueryClient().setQueryData(groupKeys.posts("group-id", null, null), {
    posts: [],
  });
}

function groupPostsInvalidated() {
  return getQueryClient().getQueryState(groupKeys.posts("group-id", null, null))
    ?.isInvalidated;
}

/**
 * 새 피드 세션은 서버가 후보를 전부 랭킹해 물리화하는 일이라, 게시물 변경마다 치를 값이
 * 아니다. 어떤 변경이 세션을 새로 여는지가 이 파일의 계약이다.
 */
describe("group post cache invalidation", () => {
  beforeEach(() => {
    resetQueryClientForTests();
  });

  it("resets the feed session when a post is created or edited", async () => {
    seedGroupPosts();
    seedFeed(["post-a"]);

    await invalidateSavedGroupPost("group-id");

    expect(groupPostsInvalidated()).toBe(true);
    expect(getQueryClient().getQueryData(feedKeys.list())).toBeUndefined();
  });

  it("drops only the deleted post instead of re-ranking the feed", async () => {
    seedGroupPosts();
    seedFeed(["post-a", "post-b"]);

    await invalidateDeletedGroupPost("group-id", "post-a");

    expect(groupPostsInvalidated()).toBe(true);
    expect(getQueryClient().getQueryData(feedKeys.list())).toMatchObject({
      pages: [{ posts: [{ post_id: "post-b" }] }],
    });
  });

  // 고정은 그룹 안의 순서일 뿐이라 전역 랭킹과 무관하다.
  it("leaves the feed session alone when a post is pinned", async () => {
    seedGroupPosts();
    seedFeed(["post-a"]);

    await invalidateGroupPostOrder("group-id");

    expect(groupPostsInvalidated()).toBe(true);
    expect(getQueryClient().getQueryData(feedKeys.list())).toMatchObject({
      pages: [{ posts: [{ post_id: "post-a" }] }],
    });
  });
});
