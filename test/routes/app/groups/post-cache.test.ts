import { beforeEach, describe, expect, it } from "vitest";

import { feedKeys } from "~/features/feed";
import { groupKeys } from "~/features/groups";
import {
  invalidateDeletedGroupPost,
  invalidatePinnedGroupPost,
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

function seedGroupPosts(
  posts: { post_id: string; is_pinned?: boolean }[] = [],
) {
  getQueryClient().setQueryData(groupKeys.posts("group-id", null), {
    pages: [{ posts, nextCursor: null }],
    pageParams: [null],
  });
}

function groupPostIds() {
  return getQueryClient()
    .getQueryData<{
      pages: { posts: { post_id: string; is_pinned?: boolean }[] }[];
    }>(groupKeys.posts("group-id", null))
    ?.pages.flatMap((page) => page.posts);
}

function groupPostsInvalidated() {
  return getQueryClient().getQueryState(groupKeys.posts("group-id", null))
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

  // 목록을 다시 받으면 더 불러온 글과 고른 카테고리가 사라진다. 그 글만 덜어낸다.
  it("drops only the deleted post instead of re-ranking the feed", async () => {
    seedGroupPosts([{ post_id: "post-a" }, { post_id: "post-b" }]);
    seedFeed(["post-a", "post-b"]);

    await invalidateDeletedGroupPost("group-id", "post-a");

    expect(groupPostsInvalidated()).toBe(false);
    expect(groupPostIds()).toEqual([{ post_id: "post-b" }]);
    expect(getQueryClient().getQueryData(feedKeys.list())).toMatchObject({
      pages: [{ posts: [{ post_id: "post-b" }] }],
    });
  });

  // 고정은 목록 순서도 전역 랭킹도 바꾸지 않는다. 목록은 아이콘만 고치고 고정 목록만 다시 읽는다.
  it("marks only the pinned list stale when a post is pinned", async () => {
    seedGroupPosts([{ post_id: "post-a", is_pinned: false }]);
    seedFeed(["post-a"]);
    getQueryClient().setQueryData(groupKeys.pinnedPosts("group-id"), []);

    await invalidatePinnedGroupPost("group-id", "post-a", true);

    expect(
      getQueryClient().getQueryState(groupKeys.pinnedPosts("group-id"))
        ?.isInvalidated,
    ).toBe(true);
    expect(groupPostsInvalidated()).toBe(false);
    expect(groupPostIds()).toEqual([{ post_id: "post-a", is_pinned: true }]);
    expect(getQueryClient().getQueryData(feedKeys.list())).toMatchObject({
      pages: [{ posts: [{ post_id: "post-a" }] }],
    });
  });
});
