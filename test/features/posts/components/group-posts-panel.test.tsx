import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listGroupPosts } = vi.hoisted(() => ({ listGroupPosts: vi.fn() }));

vi.mock("~/features/posts/data/queries", () => ({ listGroupPosts }));
vi.mock("~/features/posts/hooks/use-post-view-mode", () => ({
  usePostViewMode: () => ["card"],
}));
vi.mock("~/features/posts/components/group-post-feed", () => ({
  GroupPostFeed: ({ posts }: { posts: { title: string }[] }) => (
    <div>{posts.map((post) => post.title).join(",")}</div>
  ),
  GroupPostFeedEmpty: () => <div>비어 있음</div>,
}));

import { GroupPostsPanel } from "~/features/posts/components/group-posts-panel";
import { renderRoute } from "../../../router";

const categories = [
  {
    id: "first",
    group_id: "group-id",
    name: "첫째",
    position: 0,
    created_at: "",
    updated_at: "",
  },
  {
    id: "second",
    group_id: "group-id",
    name: "둘째",
    position: 1,
    created_at: "",
    updated_at: "",
  },
];

describe("GroupPostsPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ignores an older category response", async () => {
    let resolveFirst!: (value: any) => void;
    listGroupPosts
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValueOnce({
        posts: [{ post_id: "new", title: "새 결과" }],
        nextCursor: null,
      });
    const { user } = renderRoute(() => (
      <GroupPostsPanel
        groupId="group-id"
        slug="group"
        categories={categories}
        initialPage={{ posts: [], nextCursor: null }}
      />
    ));

    await user.click(screen.getByRole("button", { name: "첫째" }));
    await user.click(screen.getByRole("button", { name: "둘째" }));
    expect(await screen.findByText("새 결과")).toBeVisible();
    resolveFirst({
      posts: [{ post_id: "old", title: "이전 결과" }],
      nextCursor: null,
    });

    await waitFor(() =>
      expect(screen.queryByText("이전 결과")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("새 결과")).toBeVisible();
  });

  it("deduplicates load-more calls before React updates disabled state", async () => {
    let resolve!: (value: any) => void;
    listGroupPosts.mockImplementation(
      () => new Promise((next) => (resolve = next)),
    );
    renderRoute(() => (
      <GroupPostsPanel
        groupId="group-id"
        slug="group"
        categories={[]}
        initialPage={{
          posts: [{ post_id: "initial", title: "처음" } as any],
          nextCursor: {
            publishedAt: "2026-08-13",
            postId: "initial",
            isPinned: false,
          },
        }}
      />
    ));
    const button = screen.getByRole("button", { name: "이전 게시물 더 보기" });

    button.click();
    button.click();
    expect(listGroupPosts).toHaveBeenCalledTimes(1);
    resolve({ posts: [], nextCursor: null });
    await waitFor(() => expect(button).not.toBeInTheDocument());
  });
});
