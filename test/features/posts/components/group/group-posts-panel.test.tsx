import { act, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  hydrateGroupPostMedia,
  infiniteScroll,
  listGroupPinnedPosts,
  listGroupPosts,
  viewMode,
} = vi.hoisted(() => ({
  viewMode: { current: "card" },
  hydrateGroupPostMedia: vi.fn((posts: unknown) => Promise.resolve(posts)),
  infiniteScroll: { loadMore: null as (() => void) | null },
  listGroupPinnedPosts: vi.fn(),
  listGroupPosts: vi.fn(),
}));

vi.mock("~/features/posts/data/queries", () => ({
  hydrateGroupPostMedia,
  listGroupPinnedPosts,
  listGroupPosts,
}));
vi.mock("~/features/posts/hooks/use-post-view-mode", () => ({
  usePostViewMode: () => [viewMode.current],
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
    posts: {
      title: string;
      author_avatar_url?: string | null;
      is_pinned?: boolean;
    }[];
  }) => (
    <div>
      <div>{posts.map((post) => post.title).join(",")}</div>
      <div data-testid="pinned-cards">
        {posts
          .filter((post) => post.is_pinned)
          .map((post) => post.title)
          .join(",")}
      </div>
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

import { groupKeys } from "~/features/groups/data/cache";
import { GroupPostsPanel } from "~/features/posts/components/group/group-posts-panel";
import { setGroupPostPinnedInLists } from "~/features/posts/data/cache";
import type { GroupPost, GroupPostPage } from "~/features/posts/model/types";
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

const row = (post_id: string, title: string, extra: object = {}) =>
  ({ post_id, title, attachments: [], ...extra }) as unknown as GroupPost;
const cursor = (postId: string) => ({ publishedAt: "2026-08-13", postId });

function renderPanel(
  initialPage: GroupPostPage,
  panelCategories: typeof categories = [],
) {
  return renderRoute(() => (
    <GroupPostsPanel
      groupId="group-id"
      pinnedCollapsed={false}
      onPinnedCollapsedChange={() => undefined}
      slug="group"
      categories={panelCategories}
      initialPage={initialPage}
    />
  ));
}

describe("GroupPostsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    infiniteScroll.loadMore = null;
    viewMode.current = "card";
    listGroupPinnedPosts.mockResolvedValue([]);
  });

  // 고정은 목록을 다시 받지 않는다(받으면 더 불러온 글이 첫 페이지로 줄어든다). action이 고친 캐시가
  // 그대로 아이콘에 닿아야 한다.
  it("shows a pin patched into the list cache without refetching", async () => {
    const { queryClient } = renderPanel({
      posts: [row("plain", "새로 고정", { is_pinned: false })],
      nextCursor: null,
      mediaHydrated: true,
    });
    expect(await screen.findByText("새로 고정")).toBeVisible();

    act(() =>
      setGroupPostPinnedInLists(queryClient, "group-id", "plain", true),
    );

    await waitFor(() =>
      expect(screen.getByTestId("pinned-cards")).toHaveTextContent(
        /^새로 고정$/,
      ),
    );
    expect(listGroupPosts).not.toHaveBeenCalled();
  });

  // 목록 보기는 가로 고정 섹션 대신 고정 글을 목록 맨 위 행으로 올린다(기능 명세 §8.11).
  it("lists pinned posts first instead of the carousel in list view", async () => {
    viewMode.current = "list";
    listGroupPinnedPosts.mockResolvedValue([
      row("pinned", "고정 글", { is_pinned: true }),
    ]);
    renderPanel({
      posts: [
        row("newer", "새 글"),
        row("pinned", "고정 글", { is_pinned: true }),
      ],
      nextCursor: null,
    });

    expect(await screen.findByText("고정 글,새 글")).toBeVisible();
    expect(screen.queryByText("고정된 게시물")).not.toBeInTheDocument();
  });

  it("says so when the pinned list fails instead of dropping the section", async () => {
    listGroupPinnedPosts.mockRejectedValue(new Error("boom"));
    renderPanel({ posts: [], nextCursor: null });

    expect(
      await screen.findByText("고정된 게시물을 불러오지 못했습니다."),
    ).toBeInTheDocument();
  });

  it("ignores an older category response", async () => {
    let resolveFirst!: (value: GroupPostPage) => void;
    listGroupPosts
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValueOnce({
        posts: [row("new", "새 결과")],
        nextCursor: null,
      });
    const { user } = renderPanel({ posts: [], nextCursor: null }, categories);

    await user.click(screen.getByRole("button", { name: "첫째" }));
    await user.click(screen.getByRole("button", { name: "둘째" }));
    expect(await screen.findByText("새 결과")).toBeVisible();
    await act(async () => {
      resolveFirst({ posts: [row("old", "이전 결과")], nextCursor: null });
      await Promise.resolve();
    });

    expect(screen.queryByText("이전 결과")).not.toBeInTheDocument();
    expect(screen.getByText("새 결과")).toBeVisible();
  });

  it("keeps the loaded pages when returning to a category", async () => {
    listGroupPosts
      .mockResolvedValueOnce({ posts: [row("next", "다음")], nextCursor: null })
      .mockResolvedValueOnce({
        posts: [row("cat", "공지 글")],
        nextCursor: null,
      });
    const { user } = renderPanel(
      { posts: [row("initial", "처음")], nextCursor: cursor("initial") },
      categories,
    );
    act(() => infiniteScroll.loadMore?.());
    expect(await screen.findByText("처음,다음")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "첫째" }));
    expect(await screen.findByText("공지 글")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "전체" }));

    expect(await screen.findByText("처음,다음")).toBeVisible();
    expect(listGroupPosts).toHaveBeenCalledTimes(2);
  });

  it("deduplicates infinite-scroll calls while a page is in flight", async () => {
    let resolve!: (value: GroupPostPage) => void;
    listGroupPosts.mockImplementation(
      () => new Promise((next) => (resolve = next)),
    );
    renderPanel({
      posts: [row("initial", "처음")],
      nextCursor: cursor("initial"),
    });
    act(() => {
      infiniteScroll.loadMore?.();
      infiniteScroll.loadMore?.();
    });
    expect(listGroupPosts).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ posts: [], nextCursor: null });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
    expect(listGroupPosts).toHaveBeenCalledTimes(1);
  });

  it("keeps one row when adjacent pages overlap", async () => {
    listGroupPosts.mockResolvedValueOnce({
      posts: [row("same", "겹친 행"), row("next", "다음")],
      nextCursor: null,
    });
    renderPanel({ posts: [row("same", "처음")], nextCursor: cursor("same") });
    act(() => infiniteScroll.loadMore?.());
    expect(await screen.findByText("처음,다음")).toBeVisible();
  });

  // 목록 보기로 받은 페이지는 아바타·첨부를 서명하지 않았다. 카드 보기에서는 마저 서명한다.
  it("signs media for pages loaded in list view", async () => {
    hydrateGroupPostMedia.mockImplementationOnce((posts: unknown) =>
      Promise.resolve(
        (posts as GroupPost[]).map((post) => ({
          ...post,
          author_avatar_url: "https://example.com/avatar.png",
        })),
      ),
    );
    renderPanel({
      posts: [row("same", "목록에서 받은 글", { author_avatar_url: null })],
      nextCursor: null,
      mediaHydrated: false,
    });

    expect(
      await screen.findByRole("img", { name: "목록에서 받은 글 작성자" }),
    ).toHaveAttribute("src", "https://example.com/avatar.png");
    expect(hydrateGroupPostMedia).toHaveBeenCalledTimes(1);
  });

  it("drops media signed for a page that was replaced meanwhile", async () => {
    let resolveMedia!: (value: unknown) => void;
    hydrateGroupPostMedia.mockImplementationOnce(
      () => new Promise((resolve) => (resolveMedia = resolve)),
    );
    const { queryClient } = renderPanel({
      posts: [row("same", "이전 내용")],
      nextCursor: null,
      mediaHydrated: false,
    });
    await waitFor(() => expect(hydrateGroupPostMedia).toHaveBeenCalled());
    act(() => {
      queryClient.setQueryData(groupKeys.posts("group-id", null), {
        pages: [
          {
            posts: [row("same", "최신 내용")],
            nextCursor: null,
            mediaHydrated: true,
          },
        ],
        pageParams: [null],
      });
    });
    expect(await screen.findByText("최신 내용")).toBeVisible();

    await act(async () => {
      resolveMedia([row("same", "이전 내용")]);
      await Promise.resolve();
    });

    expect(screen.getByText("최신 내용")).toBeVisible();
  });

  it("offers a retry when a category fails to load", async () => {
    listGroupPosts
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        posts: [row("cat", "공지 글")],
        nextCursor: null,
      });
    const { user } = renderPanel(
      { posts: [row("initial", "처음")], nextCursor: null },
      categories,
    );

    await user.click(screen.getByRole("button", { name: "첫째" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "게시물을 불러오지 못했습니다.",
    );
    expect(screen.queryByText("비어 있음")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByText("공지 글")).toBeVisible();
  });

  // 받아 둔 목록을 다시 받다 실패해도 읽던 목록은 그대로다. 첫 페이지 실패처럼 알리지 않는다.
  it("keeps the list quiet when a background refresh fails", async () => {
    listGroupPosts.mockRejectedValueOnce(new Error("offline"));
    const { queryClient } = renderPanel({
      posts: [row("initial", "처음")],
      nextCursor: null,
    });
    expect(await screen.findByText("처음")).toBeVisible();

    await act(() =>
      queryClient
        .fetchInfiniteQuery({
          queryKey: groupKeys.posts("group-id", null),
          queryFn: () => listGroupPosts() as Promise<GroupPostPage>,
          initialPageParam: null,
        })
        .catch(() => undefined),
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("처음")).toBeVisible();
  });

  // loader는 전체 목록만 다시 받는다. 첫 페이지가 바뀌면(글 저장·당겨서 새로고침) 보고 있는 카테고리도
  // 낡았으면 다시 받는다.
  it("refreshes the selected category when the loader brings a new page", async () => {
    const loader = { setPage: null as ((page: GroupPostPage) => void) | null };
    function Panel() {
      const [page, setPage] = useState<GroupPostPage>({
        posts: [row("initial", "처음")],
        nextCursor: null,
      });
      loader.setPage = setPage;
      return (
        <GroupPostsPanel
          groupId="group-id"
          pinnedCollapsed={false}
          onPinnedCollapsedChange={() => undefined}
          slug="group"
          categories={categories}
          initialPage={page}
        />
      );
    }
    listGroupPosts
      .mockResolvedValueOnce({
        posts: [row("cat", "공지 글")],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        posts: [row("saved", "새 공지"), row("cat", "공지 글")],
        nextCursor: null,
      });
    const { user, queryClient } = renderRoute(Panel);
    await user.click(screen.getByRole("button", { name: "첫째" }));
    expect(await screen.findByText("공지 글")).toBeVisible();

    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: groupKeys.postLists("group-id"),
        refetchType: "none",
      });
      loader.setPage?.({ posts: [row("saved", "새 글")], nextCursor: null });
    });

    expect(await screen.findByText("새 공지,공지 글")).toBeVisible();
    expect(listGroupPosts).toHaveBeenCalledTimes(2);
  });
});
