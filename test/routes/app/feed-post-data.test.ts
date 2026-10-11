import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGroupPost: vi.fn(),
  getProfilePost: vi.fn(),
  listPostComments: vi.fn(),
  loadGroupDetail: vi.fn(),
}));

vi.mock("~/features/groups", async (importOriginal) => ({
  ...(await importOriginal()),
  loadGroupDetail: mocks.loadGroupDetail,
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

  // 그룹 화면을 거쳐 왔다면 그룹 행이 이미 캐시에 있다. 상세 창 하나 때문에 다시 묻지 않는다.
  it("reuses the cached group row", async () => {
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

    expect(mocks.loadGroupDetail).toHaveBeenCalledTimes(1);
  });
});
