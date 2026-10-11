import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { feedKeys, resetFeed } from "~/features/feed/data/cache";
import { patchPostEngagement, postKeys } from "~/features/posts/data/cache";

describe("resetFeed", () => {
  /**
   * 새 세션은 그룹 가입이나 글 저장으로도 열린다. 그때 다시 읽히는 건 피드뿐이라, overlay를
   * 함께 비우면 다른 화면에 열려 있는 게시물이 방금 성공한 반응·댓글 수를 옛 로더 snapshot으로
   * 되돌린 채 남는다.
   */
  it("keeps the engagement overlay of posts shown on other screens", async () => {
    const client = new QueryClient();
    patchPostEngagement(client, "post-a", {
      comment_count: 4,
      my_reaction: "like",
    });

    await resetFeed(client);

    expect(client.getQueryData(postKeys.engagement("post-a"))).toEqual({
      comment_count: 4,
      my_reaction: "like",
    });
  });

  it("drops the accumulated feed session", async () => {
    const client = new QueryClient();
    client.setQueryData(feedKeys.list(), {
      pages: [{ posts: [], feedEpoch: "epoch-1", nextPageToken: "token" }],
      pageParams: [null],
    });

    await resetFeed(client);

    expect(client.getQueryData(feedKeys.list())).toBeUndefined();
  });
});
