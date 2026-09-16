import { QueryClientProvider } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { hydrateFeedPostMedia, listFeedPosts } = vi.hoisted(() => ({
  hydrateFeedPostMedia: vi.fn(),
  listFeedPosts: vi.fn(),
}));

vi.mock("~/features/feed/data/queries", () => ({
  hydrateFeedPostMedia,
  listFeedPosts,
}));
vi.mock("~/features/app-shell", () => ({
  useAppShell: () => ({ profile: { name: "나", avatar_url: null } }),
}));
vi.mock("~/features/posts", () => ({
  GroupPostDetail: () => null,
  ProfilePostDetail: () => null,
  usePostViewMode: () => ["card"],
  useVisitedPosts: () => ({ visited: new Set<string>(), markVisited: vi.fn() }),
}));
vi.mock("~/features/feed/components/feed-post", () => ({
  FeedPostCard: ({
    post,
  }: {
    post: {
      post_id: string;
      author_avatar_path: string | null;
      comment_count?: number;
    };
  }) => (
    <div>
      {`${post.post_id}=${post.author_avatar_path ?? "unsigned"}`}
      <span>{`${post.post_id}:comments=${post.comment_count ?? 0}`}</span>
    </div>
  ),
  FeedPostRow: () => null,
}));
vi.mock("~/shared/hooks/use-infinite-scroll", () => ({
  useInfiniteScroll: () => ({ current: null }),
}));

import { FeedScreen } from "~/features/feed/components/feed-screen";
import { feedKeys, patchFeedPostCommentCount } from "~/features/feed";
import {
  getQueryClient,
  resetQueryClientForTests,
} from "~/shared/lib/query-client";
import { renderRoute } from "../../../router";
import { useSearchParams } from "react-router";

function seedSession(feedEpoch: string, postIds: string[], commentCount = 0) {
  getQueryClient().setQueryData(feedKeys.list(), {
    pages: [
      {
        posts: postIds.map((post_id) => ({
          post_id,
          author_avatar_path: null,
          attachments: [],
          comment_count: commentCount,
        })),
        feedEpoch,
        nextPageToken: null,
      },
    ],
    pageParams: [null],
  });
}

function Harness() {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <FeedScreen />
    </QueryClientProvider>
  );
}

describe("FeedScreen media hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryClientForTests();
  });

  /**
   * 서명이 날아가는 사이 피드가 리셋될 수 있다. 늦게 도착한 이전 세션의 결과가 현재 세션이
   * 채워 둔 미디어를 덮어쓰면, 그 글들은 이미 "하이드레이션 했음"으로 표시돼 있어 다시
   * 시도되지도 않는다 — 다음 세션 교체 전까지 서명 없는 이미지로 남는다.
   */
  it("ignores a hydrate response from a superseded feed session", async () => {
    const pending: (() => void)[] = [];
    hydrateFeedPostMedia.mockImplementation(
      (posts: { post_id: string }[]) =>
        new Promise((resolve) => {
          pending.push(() =>
            resolve(
              posts.map((post) => ({
                ...post,
                author_avatar_path: `signed:${post.post_id}`,
              })),
            ),
          );
        }),
    );

    seedSession("epoch-1", ["post-old"]);
    renderRoute(Harness);
    await waitFor(() => expect(pending).toHaveLength(1));

    // 이전 세션의 서명이 아직 날아가는 중에 피드가 리셋된다.
    act(() => seedSession("epoch-2", ["post-new"]));
    await waitFor(() => expect(pending).toHaveLength(2));

    // 새 세션이 먼저 도착하고, 지나간 세션이 뒤늦게 도착한다.
    await act(async () => {
      pending[1]?.();
      await Promise.resolve();
    });
    await act(async () => {
      pending[0]?.();
      await Promise.resolve();
    });

    expect(
      await screen.findByText("post-new=signed:post-new"),
    ).toBeInTheDocument();
  });

  it("keeps hydrated media for the session that is on screen", async () => {
    hydrateFeedPostMedia.mockImplementation((posts: { post_id: string }[]) =>
      Promise.resolve(
        posts.map((post) => ({
          ...post,
          author_avatar_path: `signed:${post.post_id}`,
        })),
      ),
    );

    seedSession("epoch-1", ["post-a"]);
    renderRoute(Harness);

    expect(await screen.findByText("post-a=signed:post-a")).toBeInTheDocument();
  });
});

describe("FeedScreen detail re-entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryClientForTests();
    hydrateFeedPostMedia.mockResolvedValue([]);
  });

  /**
   * `useFetcher`의 데이터는 상세를 닫아도 남는다. "이 글의 데이터가 이미 있다"로 판단하면
   * 같은 글을 다시 열었을 때 방금 쓴 댓글이 빠진 예전 응답이 그대로 뜬다.
   */
  it("re-loads the detail when the same post is opened again", async () => {
    const detailLoads: string[] = [];

    function Harness() {
      const [, setSearchParams] = useSearchParams();
      return (
        <QueryClientProvider client={getQueryClient()}>
          <button
            type="button"
            onClick={() =>
              setSearchParams({
                post: "post-a",
                kind: "group",
                source: "group-id",
              })
            }
          >
            상세 열기
          </button>
          <button type="button" onClick={() => setSearchParams({})}>
            상세 닫기
          </button>
          <FeedScreen />
        </QueryClientProvider>
      );
    }

    seedSession("epoch-1", ["post-a"]);
    const { user } = renderRoute(Harness, {
      routes: [
        {
          path: "/feed/posts/:postId",
          loader: ({ params }) => {
            detailLoads.push(params.postId!);
            return {
              requestedPostId: params.postId,
              detail: null,
              error: "불러오지 못했습니다.",
            };
          },
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "상세 열기" }));
    await waitFor(() => expect(detailLoads).toEqual(["post-a"]));

    await user.click(screen.getByRole("button", { name: "상세 닫기" }));
    await user.click(screen.getByRole("button", { name: "상세 열기" }));

    await waitFor(() => expect(detailLoads).toEqual(["post-a", "post-a"]));
  });

  /**
   * 요청을 건 순간 "읽었다"고 기록하므로, 그 요청이 이 글의 응답 없이 끝나면(중간에 끊긴
   * 경우) 다시 걸 길이 없어 상세가 열려 있는 내내 spinner만 돌아간다. 한 번은 더 건다.
   */
  it("retries once when a detail load ends without this post's data", async () => {
    const detailLoads: string[] = [];

    function Harness() {
      const [, setSearchParams] = useSearchParams();
      return (
        <QueryClientProvider client={getQueryClient()}>
          <button
            type="button"
            onClick={() =>
              setSearchParams({
                post: "post-a",
                kind: "group",
                source: "group-id",
              })
            }
          >
            상세 열기
          </button>
          <FeedScreen />
        </QueryClientProvider>
      );
    }

    seedSession("epoch-1", ["post-a"]);
    const { user } = renderRoute(Harness, {
      routes: [
        {
          path: "/feed/posts/:postId",
          loader: ({ params }) => {
            detailLoads.push(params.postId!);
            // 이 글의 응답이 실려 오지 않은 상태.
            return {
              requestedPostId: "other-post",
              detail: null,
              error: null,
            };
          },
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "상세 열기" }));
    await waitFor(() => expect(detailLoads).toEqual(["post-a", "post-a"]));

    // 재시도는 한 번으로 묶는다 — 계속 실패하는 요청을 무한히 다시 걸지 않는다.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(detailLoads).toEqual(["post-a", "post-a"]);

    // 재시도까지 빈손이면 이 버튼이 유일한 출구다.
    expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument();
  });

  /**
   * 미디어 수화본은 만들어진 시점에 멈춰 있다. 그 복사본이 화면을 이기면, 댓글을 쓰고 상세를
   * 닫은 순간 캐시가 고친 수를 수화본의 옛 수가 도로 덮는다.
   */
  it("keeps a patched comment count that media hydration would overwrite", async () => {
    hydrateFeedPostMedia.mockImplementation((posts: { post_id: string }[]) =>
      Promise.resolve(
        posts.map((post) => ({
          ...post,
          author_avatar_path: `signed:${post.post_id}`,
        })),
      ),
    );

    seedSession("epoch-1", ["post-a"], 0);
    renderRoute(Harness);

    // 수화가 끝난 뒤에 댓글 수가 갱신된다.
    expect(await screen.findByText("post-a=signed:post-a")).toBeInTheDocument();

    act(() => patchFeedPostCommentCount(getQueryClient(), "post-a", 3));

    expect(await screen.findByText("post-a:comments=3")).toBeInTheDocument();
    // 수화가 채운 미디어는 그대로 남아야 한다.
    expect(screen.getByText("post-a=signed:post-a")).toBeInTheDocument();
  });
});
