import { RouterContextProvider } from "react-router";
import type * as LanguageModule from "~/shared/i18n/language";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const locale = vi.hoisted<{ current: "ko" | "en" }>(() => ({ current: "ko" }));
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

// `clientLoader`는 node 환경에서 돌아 `localStorage`가 없다. 언어는 모듈을 통해 끼워 넣는다.
vi.mock("~/shared/i18n/language", async (importOriginal) => ({
  ...(await importOriginal<typeof LanguageModule>()),
  getCurrentLocale: () => locale.current,
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

describe("feed post detail loader in English", () => {
  afterEach(() => {
    locale.current = "ko";
  });

  it("reports an invalid path in English", async () => {
    locale.current = "en";

    const result = await load("?kind=unknown");

    expect(result).toMatchObject({
      detail: null,
      error: "Invalid post path.",
    });
  });
});
