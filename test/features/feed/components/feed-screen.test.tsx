import { QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { signFeedMedia, listFeedPosts } = vi.hoisted(() => ({
  signFeedMedia: vi.fn(),
  listFeedPosts: vi.fn(),
}));

vi.mock("~/features/feed/data/queries", () => ({
  signFeedMedia,
  listFeedPosts,
}));
vi.mock("~/features/app-shell", () => ({
  useAppShell: () => ({ profile: { id: 1, name: "나", avatar_url: null } }),
}));
vi.mock("~/features/posts", () => ({
  anonymousActivityRestrictionQuery: (groupId: string) => ({
    queryKey: ["anonymous-activity-restriction", groupId],
    queryFn: () => null,
  }),
  resolveIdentityOptions: () => ["identified"],
  groupPostPath: (slug: string, postId: string) =>
    `/groups/${slug}/posts/${postId}`,
  GroupPostDetail: ({
    post,
    comments,
  }: {
    post: { post_id: string; can_edit: boolean };
    comments: unknown;
  }) => (
    <p>{`detail:${post.post_id}:${comments ? "comments" : "loading"}:${post.can_edit ? "editable" : "locked"}`}</p>
  ),
  ProfilePostDetail: () => null,
  usePostViewMode: () => ["card"],
  useVisitedPosts: () => ({ visited: new Set<string>(), markVisited: vi.fn() }),
}));
vi.mock("~/features/feed/components/feed-post", async () => {
  const { usePostEngagement } =
    await import("~/features/posts/hooks/use-post-engagement");

  return {
    FeedPostCard: ({
      post,
      mediaPending,
    }: {
      post: {
        post_id: string;
        author_avatar_url: string | null;
        attachments: { object_path: string; signedUrl: string | null }[];
        body?: string;
        comment_count?: number;
        reaction_count?: number;
      };
      mediaPending: boolean;
    }) => {
      const engagement = usePostEngagement(post.post_id, {
        comment_count: post.comment_count ?? 0,
        reaction_count: post.reaction_count ?? 0,
        top_reactions: [],
        my_reaction: null,
      });
      return (
        <div>
          {`${post.post_id}=${post.author_avatar_url ?? "unsigned"}`}
          <span>{post.body}</span>
          <span>{`${post.post_id}:comments=${engagement.comment_count}`}</span>
          <span>{`${post.post_id}:reactions=${engagement.reaction_count}`}</span>
          {post.attachments.map((item) => (
            <span key={item.object_path}>
              {`${item.object_path}=${item.signedUrl ?? (mediaPending ? "pending" : "failed")}`}
            </span>
          ))}
        </div>
      );
    },
    FeedPostRow: () => null,
  };
});
vi.mock("~/shared/hooks/use-infinite-scroll", () => ({
  useInfiniteScroll: () => ({ current: null }),
}));

import { FeedScreen } from "~/features/feed/components/feed-screen";
import type { FeedMediaPaths } from "~/features/feed/model/media";
import type { FeedPage } from "~/features/feed/model/types";
import { feedKeys } from "~/features/feed";
import { patchPostEngagement } from "~/features/posts/data/cache";
import {
  getQueryClient,
  resetQueryClientForTests,
} from "~/shared/lib/query-client";
import { renderRoute } from "../../../router";
import { useSearchParams } from "react-router";

function feedPost(
  post_id: string,
  { commentCount = 0, reactionCount = 0, image = false } = {},
) {
  return {
    post_id,
    author_avatar_path: `avatar:${post_id}`,
    author_avatar_url: null,
    activity_media_path: null,
    activity_media_url: null,
    attachments: image
      ? [
          {
            attachment_id: `attachment:${post_id}`,
            storage_bucket: "post-attachments",
            object_path: `image:${post_id}`,
            thumbnail_path: null,
            mime_type: "image/webp",
            signedUrl: null,
            thumbnailUrl: null,
          },
        ]
      : [],
    comment_count: commentCount,
    reaction_count: reactionCount,
    top_reactions: [],
    my_reaction: null,
  };
}

function seedSession(
  feedEpoch: string,
  postIds: string[],
  commentCount = 0,
  reactionCount = 0,
) {
  seedPages(feedEpoch, [
    postIds.map((postId) => feedPost(postId, { commentCount, reactionCount })),
  ]);
}

function seedPages(feedEpoch: string, pages: ReturnType<typeof feedPost>[][]) {
  getQueryClient().setQueryData(feedKeys.list(), {
    pages: pages.map((posts, index) => ({
      posts,
      feedEpoch,
      nextPageToken: index < pages.length - 1 ? `token-${index + 1}` : null,
    })),
    pageParams: pages.map((_, index) =>
      index === 0 ? null : `token-${index}`,
    ),
  });
}

/** 받은 경로를 모두 `signed:<경로>`로 서명한다. `skip`에 든 경로는 서명 실패로 뺀다. */
function signAll(paths: FeedMediaPaths, skip: string[] = []) {
  const sign = (list: string[]) =>
    Object.fromEntries(
      list
        .filter((path) => !skip.includes(path))
        .map((path) => [path, `signed:${path}`]),
    );
  return {
    attachments: sign(paths.attachments),
    profiles: sign(paths.profiles),
  };
}

function Harness() {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <FeedScreen />
    </QueryClientProvider>
  );
}

describe("FeedScreen media signing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryClientForTests();
  });

  /**
   * 서명이 날아가는 사이 피드가 리셋될 수 있다. 늦게 도착한 이전 세션의 결과가 현재 세션의
   * 미디어로 쓰이면 안 된다.
   */
  it("ignores a signing response from a superseded feed session", async () => {
    const pending: (() => void)[] = [];
    signFeedMedia.mockImplementation(
      (paths: FeedMediaPaths) =>
        new Promise((resolve) => {
          const session = pending.length + 1;
          pending.push(() =>
            resolve({
              attachments: {},
              profiles: Object.fromEntries(
                paths.profiles.map((path) => [path, `session-${session}`]),
              ),
            }),
          );
        }),
    );

    seedSession("epoch-1", ["post-a"]);
    renderRoute(Harness);
    await waitFor(() => expect(pending).toHaveLength(1));

    // 이전 세션의 서명이 아직 날아가는 중에 피드가 리셋된다. 경로는 같다.
    act(() => seedSession("epoch-2", ["post-a"]));
    await waitFor(() => expect(pending).toHaveLength(2));

    await act(async () => {
      pending[0]?.();
      await Promise.resolve();
    });
    expect(screen.getByText("post-a=unsigned")).toBeInTheDocument();
    await act(async () => {
      pending[1]?.();
      await Promise.resolve();
    });

    expect(await screen.findByText("post-a=session-2")).toBeInTheDocument();
  });

  /** 페이지가 붙어도 앞 페이지는 다시 서명하지 않는다. */
  it("signs only the new page when the next page arrives", async () => {
    signFeedMedia.mockImplementation((paths: FeedMediaPaths) =>
      Promise.resolve(signAll(paths)),
    );
    seedPages("epoch-1", [[feedPost("post-a")]]);
    renderRoute(Harness);
    expect(
      await screen.findByText("post-a=signed:avatar:post-a"),
    ).toBeInTheDocument();

    act(() =>
      seedPages("epoch-1", [[feedPost("post-a")], [feedPost("post-b")]]),
    );

    expect(
      await screen.findByText("post-b=signed:avatar:post-b"),
    ).toBeInTheDocument();
    expect(signFeedMedia).toHaveBeenCalledTimes(2);
    expect(signFeedMedia).toHaveBeenLastCalledWith({
      attachments: [],
      profiles: ["avatar:post-b"],
    });
  });

  /** 다른 페이지가 서명 중이어도 이미 실패한 이미지를 '불러오는 중'으로 되돌리지 않는다. */
  it("marks only the page that is signing as pending", async () => {
    let finishSecond!: () => void;
    signFeedMedia.mockImplementation((paths: FeedMediaPaths) =>
      paths.attachments.includes("image:post-b")
        ? new Promise((resolve) => {
            finishSecond = () => resolve(signAll(paths));
          })
        : Promise.resolve(signAll(paths, ["image:post-a"])),
    );
    seedPages("epoch-1", [[feedPost("post-a", { image: true })]]);
    renderRoute(Harness);
    expect(await screen.findByText("image:post-a=failed")).toBeInTheDocument();

    act(() =>
      seedPages("epoch-1", [
        [feedPost("post-a", { image: true })],
        [feedPost("post-b", { image: true })],
      ]),
    );

    expect(await screen.findByText("image:post-b=pending")).toBeInTheDocument();
    expect(screen.getByText("image:post-a=failed")).toBeInTheDocument();
    act(() => finishSecond());
    expect(
      await screen.findByText("image:post-b=signed:image:post-b"),
    ).toBeInTheDocument();
  });

  /**
   * overlay는 내 뮤테이션만 담는다. 남이 남긴 댓글·반응은 배경 리페치가 가져온 raw post로만
   * 들어오므로, 서명본이 화면을 통째로 이기면 그 게시물의 수는 서명 시점에 얼어붙는다.
   */
  it("shows engagement from a background refetch on a signed card", async () => {
    signFeedMedia.mockImplementation((paths: FeedMediaPaths) =>
      Promise.resolve(signAll(paths)),
    );

    seedSession("epoch-1", ["post-a"], 0, 0);
    renderRoute(Harness);

    expect(
      await screen.findByText("post-a=signed:avatar:post-a"),
    ).toBeInTheDocument();
    expect(screen.getByText("post-a:comments=0")).toBeInTheDocument();

    act(() => seedSession("epoch-1", ["post-a"], 2, 5));

    expect(await screen.findByText("post-a:comments=2")).toBeInTheDocument();
    expect(screen.getByText("post-a:reactions=5")).toBeInTheDocument();
    expect(screen.getByText("post-a=signed:avatar:post-a")).toBeInTheDocument();
  });

  it("keeps the latest body when an older media response arrives", async () => {
    let finish!: () => void;
    signFeedMedia.mockImplementation(
      (paths: FeedMediaPaths) =>
        new Promise((resolve) => {
          finish = () => resolve(signAll(paths));
        }),
    );
    seedSession("epoch-1", ["post-a"]);
    renderRoute(Harness);
    await waitFor(() => expect(finish).toBeDefined());

    act(() => {
      getQueryClient().setQueryData<InfiniteData<FeedPage>>(
        feedKeys.list(),
        (current) =>
          current && {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              posts: page.posts.map((post) => ({
                ...post,
                body: "수정된 본문",
              })),
            })),
          },
      );
    });
    await screen.findByText("수정된 본문");
    act(() => finish());

    expect(
      await screen.findByText("post-a=signed:avatar:post-a"),
    ).toBeInTheDocument();
    expect(screen.getByText("수정된 본문")).toBeInTheDocument();
  });

  it("keeps the feed visible and lets the user retry a failed image", async () => {
    signFeedMedia
      .mockImplementationOnce((paths: FeedMediaPaths) =>
        Promise.resolve(signAll(paths, ["image:post-b"])),
      )
      .mockImplementation((paths: FeedMediaPaths) =>
        Promise.resolve(signAll(paths)),
      );
    seedPages("epoch-1", [
      [
        feedPost("post-a", { image: true }),
        feedPost("post-b", { image: true }),
      ],
    ]);
    const { user } = renderRoute(Harness);

    const retry = await screen.findByRole("button", {
      name: "이미지 다시 불러오기",
    });
    expect(
      screen.getByText("image:post-a=signed:image:post-a"),
    ).toBeInTheDocument();
    expect(screen.getByText("image:post-b=failed")).toBeInTheDocument();
    await user.click(retry);

    expect(
      await screen.findByText("image:post-b=signed:image:post-b"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("image:post-a=signed:image:post-a"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "이미지 다시 불러오기" }),
    ).not.toBeInTheDocument();
  });

  /** 지워진 객체처럼 재시도로 고칠 수 없는 실패에 버튼을 계속 남기지 않는다. */
  it("hides the retry button when a retry cannot sign the image", async () => {
    signFeedMedia.mockImplementation((paths: FeedMediaPaths) =>
      Promise.resolve(signAll(paths, ["image:post-a"])),
    );
    seedPages("epoch-1", [[feedPost("post-a", { image: true })]]);
    const { user } = renderRoute(Harness);

    await user.click(
      await screen.findByRole("button", { name: "이미지 다시 불러오기" }),
    );

    await waitFor(() => expect(signFeedMedia).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("image:post-a=failed")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "이미지 다시 불러오기" }),
    ).not.toBeInTheDocument();
  });

  /** 아바타는 대체 이미지가 있어 재시도 버튼 대상이 아니다. */
  it("does not offer an image retry for a missing avatar", async () => {
    signFeedMedia.mockResolvedValue({ attachments: {}, profiles: {} });
    seedSession("epoch-1", ["post-a"]);
    renderRoute(Harness);

    await waitFor(() => expect(signFeedMedia).toHaveBeenCalled());
    expect(screen.getByText("post-a=unsigned")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "이미지 다시 불러오기" }),
    ).not.toBeInTheDocument();
  });

  it("ignores the old avatar when its path changes during signing", async () => {
    const pending: (() => void)[] = [];
    signFeedMedia.mockImplementation(
      (paths: FeedMediaPaths) =>
        new Promise((resolve) => {
          pending.push(() => resolve(signAll(paths)));
        }),
    );
    seedSession("epoch-1", ["post-a"]);
    renderRoute(Harness);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(() =>
      getQueryClient().setQueryData<InfiniteData<FeedPage>>(
        feedKeys.list(),
        (current) =>
          current && {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              posts: page.posts.map((post) => ({
                ...post,
                author_avatar_path: "new-avatar",
              })),
            })),
          },
      ),
    );
    await waitFor(() => expect(pending).toHaveLength(2));
    act(() => pending[0]());
    expect(screen.getByText("post-a=unsigned")).toBeInTheDocument();
    act(() => pending[1]());
    expect(
      await screen.findByText("post-a=signed:new-avatar"),
    ).toBeInTheDocument();
  });

  /** 게시물 하나를 빼도 같은 페이지에 남은 이미지가 다시 '불러오는 중'으로 깜박이지 않는다. */
  it("keeps signed media on the page when a post is removed", async () => {
    let calls = 0;
    signFeedMedia.mockImplementation((paths: FeedMediaPaths) => {
      calls += 1;
      return calls === 1
        ? Promise.resolve(signAll(paths))
        : new Promise(() => undefined);
    });
    seedPages("epoch-1", [
      [
        feedPost("post-a", { image: true }),
        feedPost("post-b", { image: true }),
      ],
    ]);
    renderRoute(Harness);
    expect(
      await screen.findByText("image:post-a=signed:image:post-a"),
    ).toBeInTheDocument();

    act(() => seedPages("epoch-1", [[feedPost("post-a", { image: true })]]));

    await waitFor(() => expect(calls).toBe(2));
    expect(
      screen.getByText("image:post-a=signed:image:post-a"),
    ).toBeInTheDocument();
  });
});

describe("FeedScreen detail re-entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryClientForTests();
    signFeedMedia.mockResolvedValue({ attachments: {}, profiles: {} });
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

  // 눌린 글은 피드가 이미 들고 있다. 상세 응답을 기다리며 로딩 창을 띄우지 않는다.
  it("opens a feed post at once and fills comments when the detail arrives", async () => {
    let resolveDetail: (value: unknown) => void = () => undefined;

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
                source: "notice",
              })
            }
          >
            상세 열기
          </button>
          <FeedScreen />
        </QueryClientProvider>
      );
    }

    getQueryClient().setQueryData(feedKeys.list(), {
      pages: [
        {
          posts: [
            {
              post_id: "post-a",
              kind: "group",
              group_id: "group-id",
              group_slug: "notice",
              group_name: "공지사항",
              author_avatar_path: null,
              attachments: [],
              comment_count: 0,
              reaction_count: 0,
              top_reactions: [],
              my_reaction: null,
            },
          ],
          feedEpoch: "epoch-1",
          nextPageToken: null,
        },
      ],
      pageParams: [null],
    });
    const { user } = renderRoute(Harness, {
      routes: [
        {
          path: "/feed/posts/:postId",
          loader: () =>
            new Promise((resolve) => {
              resolveDetail = resolve;
            }),
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "상세 열기" }));

    expect(
      await screen.findByText("detail:post-a:loading:locked"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("게시물을 불러오는 중입니다."),
    ).not.toBeInTheDocument();

    act(() =>
      resolveDetail({
        requestedPostId: "post-a",
        detail: {
          kind: "group",
          post: { post_id: "post-a", can_edit: true },
          comments: { comments: [], nextCursor: null },
          slug: "notice",
          groupName: "공지사항",
          group: {
            groupId: "group-id",
            identityPolicy: "identified",
            memberRole: "member",
          },
        },
        error: null,
      }),
    );

    expect(
      await screen.findByText("detail:post-a:comments:editable"),
    ).toBeInTheDocument();
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

    // 피드에 있는 글은 미리보기로 바로 열리므로, 주소로 직접 연 글처럼 피드에 없는 글로 확인한다.
    seedSession("epoch-1", ["post-b"]);
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
   * 서명 결과가 게시물 복사본이면, 댓글을 쓰고 상세를 닫은 순간 캐시가 고친 수를 그 복사본의
   * 옛 수가 도로 덮는다.
   */
  it("keeps a patched comment count after media signing", async () => {
    signFeedMedia.mockImplementation((paths: FeedMediaPaths) =>
      Promise.resolve(signAll(paths)),
    );

    seedSession("epoch-1", ["post-a"], 0);
    renderRoute(Harness);

    // 서명이 끝난 뒤에 댓글 수가 갱신된다.
    expect(
      await screen.findByText("post-a=signed:avatar:post-a"),
    ).toBeInTheDocument();

    act(() =>
      patchPostEngagement(getQueryClient(), "post-a", { comment_count: 3 }),
    );

    expect(await screen.findByText("post-a:comments=3")).toBeInTheDocument();
    // 서명이 채운 미디어는 그대로 남아야 한다.
    expect(screen.getByText("post-a=signed:avatar:post-a")).toBeInTheDocument();
  });
});
