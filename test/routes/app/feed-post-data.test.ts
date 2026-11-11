import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGroupPost: vi.fn(),
  getProfilePost: vi.fn(),
  listPostComments: vi.fn(),
  loadGroupDetail: vi.fn(),
  markPostOpened: vi.fn(),
}));

vi.mock("~/features/groups", async (importOriginal) => ({
  ...(await importOriginal()),
  loadGroupDetail: mocks.loadGroupDetail,
}));
vi.mock("~/features/notifications/data/mutations", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  markPostOpened: mocks.markPostOpened,
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

/** 뷰어가 멤버인 그룹과 그 그룹의 게시물. */
function mockMemberGroupPost() {
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
}

describe("feed post detail loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getQueryClient().clear();
    mocks.listPostComments.mockResolvedValue({
      comments: [],
      nextCursor: null,
    });
    mocks.markPostOpened.mockResolvedValue({
      countedAsNew: false,
      notificationsRead: 0,
    });
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

  it("records a group post opened from the feed as read", async () => {
    mockMemberGroupPost();
    // 끝나지 않는 기록 — 상세는 기록을 기다리지 않고 떠야 한다.
    mocks.markPostOpened.mockReturnValue(new Promise<never>(() => undefined));

    const result = await load("?kind=group&source=notice");

    expect(result.error).toBeNull();
    expect(mocks.markPostOpened).toHaveBeenCalledExactlyOnceWith("post-id");
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
    expect(mocks.markPostOpened).not.toHaveBeenCalled();
  });

  // 타임라인 글에는 새 게시물 수가 없지만 그 글의 알림은 읽음이 된다.
  it("records a profile post opened from the feed", async () => {
    mocks.getProfilePost.mockResolvedValue({
      post_id: "post-id",
      timeline_pub_id: "someone",
    });

    const result = await load("?kind=profile&source=someone");

    expect(result.error).toBeNull();
    expect(mocks.markPostOpened).toHaveBeenCalledExactlyOnceWith("post-id");
  });

  // 캐시된 그룹 행은 최대 2분 묵었다. 그 사이 바뀐 작성 신원 정책이나 역할을 상세 창이 놓치면 안 된다.
  it("reads the group row fresh even when it is cached", async () => {
    mockMemberGroupPost();

    await load("?kind=group&source=notice");
    await load("?kind=group&source=notice");

    expect(mocks.loadGroupDetail).toHaveBeenCalledTimes(2);
  });
});
