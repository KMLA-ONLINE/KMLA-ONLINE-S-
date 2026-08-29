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
  GroupPostOverlay: () => null,
  ProfilePostDetail: () => null,
  usePostViewMode: () => ["card"],
  useVisitedPosts: () => ({ visited: new Set<string>(), markVisited: vi.fn() }),
}));
vi.mock("~/features/feed/components/feed-post", () => ({
  FeedPostCard: ({
    post,
  }: {
    post: { post_id: string; author_avatar_path: string | null };
  }) => <div>{`${post.post_id}=${post.author_avatar_path ?? "unsigned"}`}</div>,
  FeedPostRow: () => null,
}));
vi.mock("~/shared/hooks/use-infinite-scroll", () => ({
  useInfiniteScroll: () => ({ current: null }),
}));

import { FeedScreen } from "~/features/feed/components/feed-screen";
import { feedKeys } from "~/features/feed";
import {
  getQueryClient,
  resetQueryClientForTests,
} from "~/shared/lib/query-client";
import { renderRoute } from "../../../router";

function seedSession(feedEpoch: string, postIds: string[]) {
  getQueryClient().setQueryData(feedKeys.list(), {
    pages: [
      {
        posts: postIds.map((post_id) => ({
          post_id,
          author_avatar_path: null,
          attachments: [],
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
