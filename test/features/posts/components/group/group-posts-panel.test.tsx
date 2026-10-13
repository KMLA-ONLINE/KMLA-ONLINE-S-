import { act, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { hydrateGroupPostMedia, infiniteScroll, listGroupPosts } = vi.hoisted(
  () => ({
    hydrateGroupPostMedia: vi.fn((posts: unknown) => Promise.resolve(posts)),
    infiniteScroll: { loadMore: null as (() => void) | null },
    listGroupPosts: vi.fn(),
  }),
);

vi.mock("~/features/posts/data/queries", () => ({
  hydrateGroupPostMedia,
  listGroupPosts,
}));
vi.mock("~/features/posts/hooks/use-post-view-mode", () => ({
  usePostViewMode: () => ["card"],
}));
vi.mock("~/shared/hooks/use-infinite-scroll", () => ({
  useInfiniteScroll: (loadMore: () => void) => {
    infiniteScroll.loadMore = loadMore;
    return () => undefined;
  },
}));
vi.mock("~/features/posts/components/group/group-post-feed", () => ({
  GroupPostFeed: ({
    posts,
  }: {
    posts: { title: string; author_avatar_url?: string | null }[];
  }) => (
    <div>
      <div>{posts.map((post) => post.title).join(",")}</div>
      {posts.map((post) =>
        post.author_avatar_url ? (
          <img
            key={post.title}
            src={post.author_avatar_url}
            alt={`${post.title} 작성자`}
          />
        ) : null,
      )}
    </div>
  ),
  GroupPostFeedEmpty: () => <div>비어 있음</div>,
}));

import { GroupPostsPanel } from "~/features/posts/components/group/group-posts-panel";
import type { GroupPost, GroupPostPage } from "~/features/posts/model/types";
import { getQueryClient } from "~/shared/lib/query-client";
import { renderRoute } from "../../../../router";

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
  beforeEach(() => {
    vi.clearAllMocks();
    infiniteScroll.loadMore = null;
  });

  it("ignores an older category response", async () => {
    let resolveFirst!: (value: any) => void;
    listGroupPosts
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValueOnce({
        posts: [{ post_id: "new", title: "새 결과", attachments: [] }],
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
      posts: [{ post_id: "old", title: "이전 결과", attachments: [] }],
      nextCursor: null,
    });

    await waitFor(() =>
      expect(screen.queryByText("이전 결과")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("새 결과")).toBeVisible();
  });

  it("deduplicates infinite-scroll calls before React updates pending state", async () => {
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
          posts: [
            { post_id: "initial", title: "처음", attachments: [] } as any,
          ],
          nextCursor: {
            publishedAt: "2026-08-13",
            postId: "initial",
            isPinned: false,
          },
        }}
      />
    ));
    act(() => {
      infiniteScroll.loadMore?.();
      infiniteScroll.loadMore?.();
    });
    expect(listGroupPosts).toHaveBeenCalledTimes(1);
    resolve({ posts: [], nextCursor: null });
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });

  it("does not append the cached page twice before the result commits", async () => {
    listGroupPosts.mockResolvedValue({
      posts: [{ post_id: "next", title: "다음", attachments: [] }],
      nextCursor: null,
    });
    renderRoute(() => (
      <GroupPostsPanel
        groupId="group-id"
        slug="group"
        categories={[]}
        initialPage={{
          posts: [
            { post_id: "initial", title: "처음", attachments: [] } as any,
          ],
          nextCursor: {
            publishedAt: "2026-08-13",
            postId: "initial",
            isPinned: false,
          },
        }}
      />
    ));
    await act(async () => {
      const loadMore = infiniteScroll.loadMore!;
      loadMore();
      // Let fetchQuery settle without allowing React to commit the new cursor.
      for (let index = 0; index < 20; index++) await Promise.resolve();
      loadMore();
      for (let index = 0; index < 20; index++) await Promise.resolve();
    });
    expect(screen.getByText("처음,다음")).toBeVisible();
    expect(listGroupPosts).toHaveBeenCalledTimes(1);
  });

  it("ignores media from the previous first page", async () => {
    let resolveMedia!: (value: any) => void;
    hydrateGroupPostMedia.mockImplementationOnce(
      () => new Promise((resolve) => (resolveMedia = resolve)),
    );
    let replacePage!: (page: GroupPostPage) => void;
    renderRoute(function Harness() {
      const [page, setPage] = useState<GroupPostPage>({
        posts: [
          { post_id: "same", title: "이전 내용", attachments: [] } as any,
        ],
        nextCursor: null,
      });
      replacePage = setPage;
      return (
        <GroupPostsPanel
          groupId="group-id"
          slug="group"
          categories={[]}
          initialPage={page}
        />
      );
    });
    act(() =>
      replacePage({
        posts: [
          { post_id: "same", title: "최신 내용", attachments: [] } as any,
        ],
        nextCursor: null,
      }),
    );
    expect(await screen.findByText("최신 내용")).toBeVisible();
    await act(async () => {
      resolveMedia([{ post_id: "same", title: "이전 내용" }]);
      await Promise.resolve();
    });
    expect(screen.getByText("최신 내용")).toBeVisible();
  });

  it("clears loading when the first page replaces an in-flight page request", async () => {
    let resolvePage!: (value: any) => void;
    listGroupPosts.mockImplementationOnce(
      () => new Promise((resolve) => (resolvePage = resolve)),
    );
    const cursor = {
      publishedAt: "2026-08-13",
      postId: "same",
      isPinned: false,
    };
    let replacePage!: (page: GroupPostPage) => void;
    renderRoute(function Harness() {
      const [page, setPage] = useState<GroupPostPage>({
        posts: [{ post_id: "same", title: "처음", attachments: [] } as any],
        nextCursor: cursor,
      });
      replacePage = setPage;
      return (
        <GroupPostsPanel
          groupId="group-id"
          slug="group"
          categories={[]}
          initialPage={page}
        />
      );
    });
    act(() => infiniteScroll.loadMore?.());
    expect(screen.getByRole("status")).toBeVisible();
    act(() =>
      replacePage({
        posts: [
          { post_id: "same", title: "새 첫 페이지", attachments: [] } as any,
        ],
        nextCursor: { ...cursor, publishedAt: "2026-08-14" },
      }),
    );
    await act(async () => {
      resolvePage({
        posts: [{ post_id: "old", title: "오래된 페이지", attachments: [] }],
        nextCursor: null,
      });
      await Promise.resolve();
    });
    expect(screen.getByText("새 첫 페이지")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    listGroupPosts.mockResolvedValueOnce({
      posts: [{ post_id: "next", title: "새 다음 페이지", attachments: [] }],
      nextCursor: null,
    });
    act(() => infiniteScroll.loadMore?.());
    await waitFor(() => expect(listGroupPosts).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText("새 첫 페이지,새 다음 페이지"),
    ).toBeVisible();
  });

  it("keeps one row when adjacent pages overlap", async () => {
    listGroupPosts.mockResolvedValueOnce({
      posts: [
        { post_id: "same", title: "겹친 행", attachments: [] },
        { post_id: "next", title: "다음", attachments: [] },
      ],
      nextCursor: null,
    });
    renderRoute(() => (
      <GroupPostsPanel
        groupId="group-id"
        slug="group"
        categories={[]}
        initialPage={{
          posts: [{ post_id: "same", title: "처음", attachments: [] } as any],
          nextCursor: {
            publishedAt: "2026-08-13",
            postId: "same",
            isPinned: false,
          },
        }}
      />
    ));
    act(() => infiniteScroll.loadMore?.());
    expect(await screen.findByText("처음,다음")).toBeVisible();
  });

  it("hydrates retained cards after a category request fails", async () => {
    getQueryClient().setDefaultOptions({ queries: { retry: false } });
    let resolveMedia!: (value: any) => void;
    hydrateGroupPostMedia
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveMedia = resolve)),
      )
      .mockImplementationOnce((posts: unknown) =>
        Promise.resolve(
          (posts as GroupPost[]).map((post) => ({
            ...post,
            author_avatar_url: "https://example.com/avatar.png",
          })),
        ),
      );
    listGroupPosts.mockRejectedValueOnce(new Error("offline"));
    const { user } = renderRoute(() => (
      <GroupPostsPanel
        groupId="group-id"
        slug="group"
        categories={categories}
        initialPage={{
          posts: [
            {
              post_id: "same",
              title: "유지된 카드",
              attachments: [],
              author_avatar_url: null,
            } as any,
          ],
          nextCursor: null,
        }}
      />
    ));
    await user.click(screen.getByRole("button", { name: "첫째" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "게시물을 불러오지 못했습니다.",
    );
    await act(async () => {
      resolveMedia([
        {
          post_id: "same",
          title: "유지된 카드",
          attachments: [],
          author_avatar_url: "https://example.com/old.png",
        },
      ]);
      await Promise.resolve();
    });
    expect(
      await screen.findByRole("img", { name: "유지된 카드 작성자" }),
    ).toHaveAttribute("src", "https://example.com/avatar.png");
  });
});
