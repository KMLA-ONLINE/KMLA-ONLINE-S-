import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  clearPostEngagement,
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
