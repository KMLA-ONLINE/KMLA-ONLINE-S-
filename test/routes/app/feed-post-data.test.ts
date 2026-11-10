import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGroupPost: vi.fn(),
  getProfilePost: vi.fn(),
  listPostComments: vi.fn(),
  loadGroupDetail: vi.fn(),
  markPostRead: vi.fn(),
}));

vi.mock("~/features/groups", async (importOriginal) => ({
  ...(await importOriginal()),
  loadGroupDetail: mocks.loadGroupDetail,
}));
vi.mock("~/features/groups/data/mutations", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  markPostRead: mocks.markPostRead,
}));

vi.mock("~/features/posts", () => ({
  getGroupPost: mocks.getGroupPost,
  getProfilePost: mocks.getProfilePost,
  listPostComments: mocks.listPostComments,
}));

import { clientLoader } from "~/routes/app/feed/post-data";
import { getQueryClient } from "~/shared/lib/query-client";

function load(query: string) {
  const url = `https://example.com/feed/posts/post-id${query}`;
  return clientLoader({
    params: { postId: "post-id" },
    context: new RouterContextProvider(),
    request: new Request(url),
    url: new URL(url),
    pattern: "/feed/posts/:postId",
    serverLoader: () => Promise.resolve(undefined),
  });
}

describe("feed post detail loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getQueryClient().clear();
    mocks.listPostComments.mockResolvedValue({
      comments: [],
      nextCursor: null,
    });
    mocks.markPostRead.mockResolvedValue(false);
  });

  it("loads a group post without navigating to the group screen", async () => {
    mocks.getGroupPost.mockResolvedValue({
      post_id: "post-id",
      group_id: "group-id",
    });
    mocks.loadGroupDetail.mockResolvedValue({
      group_id: "group-id",
      slug: "notice",
      name: "공지사항",
      membership_state: "member",
      identity_policy: "optional_anonymous",
      member_role: "member",
    });

    const result = await load("?kind=group&source=notice");

    expect(result).toMatchObject({
      requestedPostId: "post-id",
      detail: {
        kind: "group",
        slug: "notice",
        groupName: "공지사항",
        group: {
          groupId: "group-id",
          identityPolicy: "optional_anonymous",
          memberRole: "member",
        },
      },
      error: null,
    });
  });

  it("rejects a group source that does not own the post", async () => {
    mocks.getGroupPost.mockResolvedValue({
      post_id: "post-id",
      group_id: "other-group-id",
    });
    mocks.loadGroupDetail.mockResolvedValue({
      group_id: "group-id",
      membership_state: "member",
    });

    const result = await load("?kind=group&source=notice");

    expect(result).toMatchObject({
      requestedPostId: "post-id",
      detail: null,
      error: "게시물을 볼 수 없습니다.",
    });
  });

  // 피드는 그룹 게시물 route로 가지 않고 이 loader로 상세를 띄운다. 여기서 빠지면 피드에서 읽은 글이
  // 그룹 홈의 새 게시물 수에 계속 남는다(§7.19).
  it("records a group post opened from the feed as read", async () => {
    mocks.getGroupPost.mockResolvedValue({
      post_id: "post-id",
      group_id: "group-id",
    });
    mocks.loadGroupDetail.mockResolvedValue({
      group_id: "group-id",
      slug: "notice",
      name: "공지사항",
      membership_state: "member",
      identity_policy: "identified",
      member_role: "member",
    });
    // 끝나지 않는 기록 — 상세는 기록을 기다리지 않고 떠야 한다.
    mocks.markPostRead.mockReturnValue(new Promise<boolean>(() => undefined));

    const result = await load("?kind=group&source=notice");

    expect(result.error).toBeNull();
    expect(mocks.markPostRead).toHaveBeenCalledExactlyOnceWith("post-id");
  });

  it("does not record a group post the viewer cannot open", async () => {
    mocks.getGroupPost.mockResolvedValue({
      post_id: "post-id",
      group_id: "group-id",
    });
    mocks.loadGroupDetail.mockResolvedValue({
      group_id: "group-id",
      membership_state: "none",
    });

    const result = await load("?kind=group&source=notice");

    expect(result.detail).toBeNull();
    expect(mocks.markPostRead).not.toHaveBeenCalled();
  });

  it("does not record a profile post", async () => {
    mocks.getProfilePost.mockResolvedValue({
      post_id: "post-id",
      timeline_pub_id: "someone",
    });

    const result = await load("?kind=profile&source=someone");

    expect(result.error).toBeNull();
    expect(mocks.markPostRead).not.toHaveBeenCalled();
  });

  // 캐시된 그룹 행은 최대 2분 묵었다. 그 사이 바뀐 작성 신원 정책이나 역할을 상세 창이 놓치면 안 된다.
  it("reads the group row fresh even when it is cached", async () => {
    mocks.getGroupPost.mockResolvedValue({
      post_id: "post-id",
      group_id: "group-id",
    });
    mocks.loadGroupDetail.mockResolvedValue({
      group_id: "group-id",
      slug: "notice",
      name: "공지사항",
      membership_state: "member",
      identity_policy: "identified",
      member_role: "member",
    });

    await load("?kind=group&source=notice");
    await load("?kind=group&source=notice");

    expect(mocks.loadGroupDetail).toHaveBeenCalledTimes(2);
  });
});
