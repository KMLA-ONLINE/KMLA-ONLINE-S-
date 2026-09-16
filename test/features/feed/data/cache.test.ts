import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  feedKeys,
  patchFeedPostCommentCount,
} from "~/features/feed/data/cache";

function seed(
  client: QueryClient,
  pages: { post_id: string; count: number }[][],
) {
  client.setQueryData(feedKeys.list(), {
    pages: pages.map((posts, index) => ({
      posts: posts.map(({ post_id, count }) => ({
        post_id,
        comment_count: count,
      })),
      feedEpoch: "epoch",
      nextPageToken: index === pages.length - 1 ? null : `token-${index}`,
    })),
    pageParams: pages.map((_, index) =>
      index === 0 ? null : `token-${index}`,
    ),
  });
}

function read(client: QueryClient) {
  const data = client.getQueryData<{
    pages: { posts: { post_id: string; comment_count: number }[] }[];
  }>(feedKeys.list())!;
  return data.pages.flatMap((page) => page.posts);
}

describe("patchFeedPostCommentCount", () => {
  it("patches the post on whichever page holds it", () => {
    const client = new QueryClient();
    seed(client, [
      [{ post_id: "post-a", count: 1 }],
      [{ post_id: "post-b", count: 2 }],
    ]);

    patchFeedPostCommentCount(client, "post-b", 3);

    expect(read(client)).toEqual([
      { post_id: "post-a", comment_count: 1 },
      { post_id: "post-b", comment_count: 3 },
    ]);
  });

  it("leaves unrelated posts alone", () => {
    const client = new QueryClient();
    seed(client, [
      [
        { post_id: "post-a", count: 1 },
        { post_id: "post-b", count: 5 },
      ],
    ]);

    patchFeedPostCommentCount(client, "post-a", 2);

    expect(read(client)).toEqual([
      { post_id: "post-a", comment_count: 2 },
      { post_id: "post-b", comment_count: 5 },
    ]);
  });

  /**
   * 댓글을 연달아 달면 응답 순서가 보장되지 않는다. 늦게 도착한 예전 응답이 이미 반영된 최신
   * 수를 도로 낮추면, 목록이 방금 쓴 댓글을 잃은 것처럼 보인다.
   */
  it("never lowers a count that is already higher", () => {
    const client = new QueryClient();
    seed(client, [[{ post_id: "post-a", count: 4 }]]);

    patchFeedPostCommentCount(client, "post-a", 2);

    expect(read(client)).toEqual([{ post_id: "post-a", comment_count: 4 }]);
  });

  it("does nothing when the feed has no cached session", () => {
    const client = new QueryClient();

    expect(() => patchFeedPostCommentCount(client, "post-a", 2)).not.toThrow();
    expect(client.getQueryData(feedKeys.list())).toBeUndefined();
  });
});
