import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  groupKeys,
  isGroupAccessQuery,
  patchGroupPostCommentCount,
} from "~/features/groups/data/cache";
import type { GroupPost } from "~/features/posts/model/types";

describe("group query keys", () => {
  it("separates discovery filters and cursors", () => {
    const first = groupKeys.discovery("사진", false, null);
    const joined = groupKeys.discovery("사진", true, null);
    const next = groupKeys.discovery("사진", false, {
      rank: 1,
      memberCount: 20,
      groupId: "group-id",
    });

    expect(first).not.toEqual(joined);
    expect(first).not.toEqual(next);
  });

  it("keeps every group query under the common root", () => {
    expect(groupKeys.home()[0]).toBe("groups");
    expect(groupKeys.detail("slug")[0]).toBe("groups");
    expect(groupKeys.posts("group-id", null, null)[0]).toBe("groups");
  });

  it("identifies protected queries for one group", () => {
    expect(
      isGroupAccessQuery(
        groupKeys.posts("group-id", null, null),
        "group-id",
        "slug",
      ),
    ).toBe(true);
    expect(
      isGroupAccessQuery(groupKeys.detail("slug"), "group-id", "slug"),
    ).toBe(true);
    expect(
      isGroupAccessQuery(
        groupKeys.posts("other", null, null),
        "group-id",
        "slug",
      ),
    ).toBe(false);
    expect(isGroupAccessQuery(groupKeys.home(), "group-id", "slug")).toBe(
      false,
    );
  });
});

describe("patchGroupPostCommentCount", () => {
  const post = (post_id: string, comment_count: number) =>
    ({ post_id, comment_count }) as GroupPost;

  function seed(client: QueryClient) {
    // 같은 글이 "전체"와 자기 카테고리 양쪽 엔트리에 동시에 들어 있다.
    client.setQueryData(groupKeys.posts("group-id", null, null), {
      posts: [post("post-a", 1), post("post-b", 9)],
      nextCursor: null,
    });
    client.setQueryData(groupKeys.posts("group-id", "category-id", null), {
      posts: [post("post-a", 1)],
      nextCursor: null,
    });
    client.setQueryData(
      groupKeys.posts("group-id", null, {
        publishedAt: "2026-01-01T00:00:00Z",
        postId: "post-z",
        isPinned: false,
      }),
      { posts: [post("post-a", 1)], nextCursor: null },
    );
    client.setQueryData(groupKeys.posts("other-group", null, null), {
      posts: [post("post-a", 1)],
      nextCursor: null,
    });
  }

  const countsFor = (client: QueryClient, key: readonly unknown[]) =>
    client
      .getQueryData<{ posts: { comment_count: number }[] }>(key)!
      .posts.map((entry) => entry.comment_count);

  it("patches every category and cursor entry of the group", () => {
    const client = new QueryClient();
    seed(client);

    patchGroupPostCommentCount(client, "group-id", "post-a", 4);

    expect(countsFor(client, groupKeys.posts("group-id", null, null))).toEqual([
      4, 9,
    ]);
    expect(
      countsFor(client, groupKeys.posts("group-id", "category-id", null)),
    ).toEqual([4]);
    expect(
      countsFor(
        client,
        groupKeys.posts("group-id", null, {
          publishedAt: "2026-01-01T00:00:00Z",
          postId: "post-z",
          isPinned: false,
        }),
      ),
    ).toEqual([4]);
  });

  it("leaves other groups alone", () => {
    const client = new QueryClient();
    seed(client);

    patchGroupPostCommentCount(client, "group-id", "post-a", 4);

    expect(
      countsFor(client, groupKeys.posts("other-group", null, null)),
    ).toEqual([1]);
  });

  it("lowers the count when comments were deleted", () => {
    const client = new QueryClient();
    seed(client);

    patchGroupPostCommentCount(client, "group-id", "post-b", 3);

    expect(countsFor(client, groupKeys.posts("group-id", null, null))).toEqual([
      1, 3,
    ]);
  });
});
