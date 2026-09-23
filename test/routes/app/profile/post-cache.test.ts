import { beforeEach, describe, expect, it } from "vitest";

import { feedKeys } from "~/features/feed";
import {
  invalidateDeletedProfilePost,
  invalidateSavedProfilePost,
} from "~/routes/app/profile/post-cache";
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

describe("profile post cache invalidation", () => {
  beforeEach(() => {
    resetQueryClientForTests();
  });

  it("resets the feed session when a post is created or edited", async () => {
    seedFeed(["post-a"]);

    await invalidateSavedProfilePost();

    expect(getQueryClient().getQueryData(feedKeys.list())).toBeUndefined();
  });

  it("drops only the deleted post instead of re-ranking the feed", () => {
    seedFeed(["post-a", "post-b"]);

    invalidateDeletedProfilePost("post-b");

    expect(getQueryClient().getQueryData(feedKeys.list())).toMatchObject({
      pages: [{ posts: [{ post_id: "post-a" }] }],
    });
  });
});
