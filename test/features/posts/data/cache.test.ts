import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const { listGroupPosts } = vi.hoisted(() => ({ listGroupPosts: vi.fn() }));
vi.mock("~/features/posts/data/queries", () => ({ listGroupPosts }));

import { groupKeys } from "~/features/groups/data/cache";
import {
  clearPostEngagement,
  fetchGroupPosts,
  patchPostEngagement,
  postKeys,
} from "~/features/posts/data/cache";

describe("post engagement cache", () => {
  it("merges partial patches without dropping another engagement field", () => {
    const client = new QueryClient();

    patchPostEngagement(client, "post-a", { comment_count: 4 });
    patchPostEngagement(client, "post-a", {
      reaction_count: 2,
      my_reaction: "like",
    });

    expect(client.getQueryData(postKeys.engagement("post-a"))).toEqual({
      comment_count: 4,
      reaction_count: 2,
      my_reaction: "like",
    });
  });

  it("keeps engagements isolated by post", () => {
    const client = new QueryClient();

    patchPostEngagement(client, "post-a", { comment_count: 4 });
    patchPostEngagement(client, "post-b", { comment_count: 1 });

    expect(client.getQueryData(postKeys.engagement("post-a"))).toEqual({
      comment_count: 4,
    });
    expect(client.getQueryData(postKeys.engagement("post-b"))).toEqual({
      comment_count: 1,
    });
  });

  it("accepts a lowered canonical comment count", () => {
    const client = new QueryClient();

    patchPostEngagement(client, "post-a", { comment_count: 4 });
    patchPostEngagement(client, "post-a", { comment_count: 1 });

    expect(client.getQueryData(postKeys.engagement("post-a"))).toEqual({
      comment_count: 1,
    });
  });

  it("clears one post or every post before a server refresh", () => {
    const client = new QueryClient();
    patchPostEngagement(client, "post-a", { comment_count: 4 });
    patchPostEngagement(client, "post-b", { comment_count: 1 });

    clearPostEngagement(client, "post-a");

    expect(client.getQueryData(postKeys.engagement("post-a"))).toBeUndefined();
    expect(client.getQueryData(postKeys.engagement("post-b"))).toEqual({
      comment_count: 1,
    });

    clearPostEngagement(client);

    expect(client.getQueryData(postKeys.engagement("post-b"))).toBeUndefined();
  });
});

describe("fetchGroupPosts", () => {
  // 낡은 목록은 첫 페이지로 줄여 다시 받는다. 받기에 실패하면 더 불러온 페이지를 잃지 않아야 한다.
  it("restores the loaded pages when the restart fails", async () => {
    const client = new QueryClient();
    const key = groupKeys.posts("group-id", null);
    const loaded = {
      pages: [
        { posts: [], nextCursor: { publishedAt: "", postId: "a" } },
        { posts: [], nextCursor: null },
      ],
      pageParams: [null, { publishedAt: "", postId: "a" }],
    };
    const updatedAt = Date.now() - 10 * 60_000;
    client.setQueryData(key, loaded, { updatedAt });
    listGroupPosts.mockRejectedValueOnce(new Error("offline"));

    await expect(
      fetchGroupPosts(client, "group-id", null, true),
    ).rejects.toThrow("offline");

    expect(client.getQueryData(key)).toEqual(loaded);
    expect(client.getQueryState(key)?.dataUpdatedAt).toBe(updatedAt);
  });
});
