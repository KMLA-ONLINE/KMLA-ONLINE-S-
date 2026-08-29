import { act, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { infiniteScroll, listProfilePosts } = vi.hoisted(() => ({
  infiniteScroll: { loadMore: null as (() => void) | null },
  listProfilePosts: vi.fn(),
}));

vi.mock("~/features/posts/data/queries", () => ({ listProfilePosts }));
vi.mock("~/shared/hooks/use-infinite-scroll", () => ({
  useInfiniteScroll: (loadMore: () => void) => {
    infiniteScroll.loadMore = loadMore;
    return () => undefined;
  },
}));
vi.mock("~/features/posts/components/profile-post-card", () => ({
  ProfilePostCard: ({ post }: { post: { post_id: string } }) => (
    <div>{post.post_id}</div>
  ),
}));

import { ProfilePostsPanel } from "~/features/posts/components/profile-posts-panel";
import type { ProfilePostPage } from "~/features/posts/model/types";
import { profilePost } from "../profile-post-fixture";
import { renderRoute } from "../../../router";

function renderPanel(
  props: Partial<Parameters<typeof ProfilePostsPanel>[0]> = {},
) {
  return renderRoute(() => (
    <ProfilePostsPanel
      timelinePubId="jieun-29"
      canWrite
      isOwnTimeline={false}
      viewerName="홍길동"
      viewerAvatarUrl={null}
      initialPage={{ posts: [], nextCursor: null }}
      {...props}
    />
  ));
}

describe("ProfilePostsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    infiniteScroll.loadMore = null;
  });

  it("offers the write row when the timeline accepts posts", () => {
    renderPanel();

    expect(screen.getByRole("link", { name: "글쓰기…" })).toHaveAttribute(
      "href",
      "/profile/jieun-29/posts/new",
    );
  });

  /**
   * 진입줄 아바타는 타임라인 당사자가 아니라 **글을 쓰는 나**다. 남의 타임라인에서 갈리므로
   * 여기서 고정한다. jsdom은 이미지를 로드하지 않아 Avatar가 늘 폴백으로 떨어지지만, 대체
   * 텍스트는 어느 쪽이든 넘긴 이름을 그대로 쓴다.
   *
   * 낭독기에서는 감춘다 — 링크 이름이 "홍길동 프로필 사진 글쓰기…"가 되면 이 링크가 무엇을
   * 하는지가 뒤로 밀린다.
   */
  it("shows my own avatar on someone else timeline without renaming the link", () => {
    renderPanel({ viewerName: "홍길동" });

    expect(screen.getByAltText("홍길동 프로필 사진")).toBeInTheDocument();
    // 아바타가 `aria-hidden`이 아니었다면 링크 이름이 대체 텍스트까지 삼켜 이 조회가 깨진다.
    expect(screen.getByRole("link", { name: "글쓰기…" })).toBeVisible();
  });

  // 설정을 끈 사실을 굳이 광고하지 않는다. 진입줄 자체를 그리지 않는다.
  it("hides the write row when the timeline is closed to others", () => {
    renderPanel({ canWrite: false });

    expect(
      screen.queryByRole("link", { name: "글쓰기…" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "이 사용자는 타임라인에 다른 사람의 글을 받지 않습니다.",
      ),
    ).toBeVisible();
  });

  it("invites the owner to post first on their own empty timeline", () => {
    renderPanel({ isOwnTimeline: true });

    expect(screen.getByText("첫 게시물을 남겨보세요.")).toBeVisible();
  });

  it("appends the next page without revalidating the route", async () => {
    listProfilePosts.mockResolvedValue({
      posts: [profilePost({ post_id: "older" })],
      nextCursor: null,
    });
    renderPanel({
      initialPage: {
        posts: [profilePost({ post_id: "newest" })],
        nextCursor: { publishedAt: "2026-08-18T00:00:00Z", postId: "newest" },
      },
    });

    act(() => infiniteScroll.loadMore?.());

    await waitFor(() => expect(screen.getByText("older")).toBeVisible());
    expect(screen.getByText("newest")).toBeVisible();
    expect(listProfilePosts).toHaveBeenCalledWith("jieun-29", {
      publishedAt: "2026-08-18T00:00:00Z",
      postId: "newest",
    });
  });

  /**
   * 재검증(작성·삭제 뒤)은 목록을 첫 페이지로 되돌린다. 그 전에 띄운 "더 보기"가 뒤늦게
   * 도착해 이어 붙으면 방금 지운 게시물이 되살아나거나 새 첫 페이지 위에 옛 뒷장이 얹힌다.
   */
  it("drops an in-flight page when the loader resets the list", async () => {
    let deliver!: (page: ProfilePostPage) => void;
    listProfilePosts.mockReturnValue(
      new Promise<ProfilePostPage>((resolve) => {
        deliver = resolve;
      }),
    );

    function RevalidationHarness() {
      const [revalidated, setRevalidated] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setRevalidated(true)}>
            재검증
          </button>
          <ProfilePostsPanel
            timelinePubId="jieun-29"
            canWrite
            isOwnTimeline={false}
            viewerName="홍길동"
            viewerAvatarUrl={null}
            initialPage={
              revalidated
                ? {
                    posts: [profilePost({ post_id: "fresh" })],
                    nextCursor: null,
                  }
                : {
                    posts: [profilePost({ post_id: "newest" })],
                    nextCursor: {
                      publishedAt: "2026-08-18T00:00:00Z",
                      postId: "newest",
                    },
                  }
            }
          />
        </>
      );
    }

    const { user } = renderRoute(RevalidationHarness);

    act(() => infiniteScroll.loadMore?.());
    await user.click(screen.getByRole("button", { name: "재검증" }));
    deliver({ posts: [profilePost({ post_id: "stale" })], nextCursor: null });

    await waitFor(() => expect(screen.getByText("fresh")).toBeVisible());
    expect(screen.queryByText("stale")).not.toBeInTheDocument();
    expect(screen.queryByText("newest")).not.toBeInTheDocument();
  });

  it("reports a failed page load without losing what is on screen", async () => {
    listProfilePosts.mockRejectedValue(new Error("network"));
    renderPanel({
      initialPage: {
        posts: [profilePost({ post_id: "newest" })],
        nextCursor: { publishedAt: "2026-08-18T00:00:00Z", postId: "newest" },
      },
    });

    act(() => infiniteScroll.loadMore?.());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "이전 게시물을 불러오지 못했습니다.",
    );
    expect(screen.getByText("newest")).toBeVisible();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeVisible();
  });
});
