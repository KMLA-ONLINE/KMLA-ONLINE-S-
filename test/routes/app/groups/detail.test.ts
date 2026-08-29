import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";

const mutations = vi.hoisted(() => ({
  approveGroupJoinRequest: vi.fn(),
  rejectGroupJoinRequest: vi.fn(),
  setGroupMemberRole: vi.fn(),
  transferGroupOwnership: vi.fn(),
  updateGroupSettings: vi.fn(),
  loadGroupDetail: vi.fn(),
  listGroupCategories: vi.fn(),
  listGroupPosts: vi.fn(),
}));

vi.mock("~/features/groups", async (importOriginal) => ({
  ...(await importOriginal()),
  ...mutations,
}));

vi.mock("~/features/posts", async (importOriginal) => ({
  ...(await importOriginal()),
  listGroupCategories: mutations.listGroupCategories,
  listGroupPosts: mutations.listGroupPosts,
}));

import { groupKeys } from "~/features/groups";
import {
  clientAction,
  clientLoader,
  shouldRevalidate,
} from "~/routes/app/groups/detail";
import { getQueryClient } from "~/shared/lib/query-client";

const group = {
  id: "group-id",
  group_id: "group-id",
  slug: "test",
  name: "테스트 그룹",
  description: "",
  kind: "official",
  join_policy: "open",
  identity_policy: "identified",
  posting_policy: "members",
  icon_path: null,
  cover_path: null,
  member_count: 1,
  membership_state: "member",
  member_role: "member",
  requested_at: null,
  pinned_at: null,
} as const;

function load(pathname: string) {
  const url = new URL(`https://example.com${pathname}`);
  return clientLoader({
    request: new Request(url),
    params: { slug: "test" },
    context: new RouterContextProvider(),
    url,
    pattern: "/groups/:slug",
    serverLoader: () => Promise.resolve(undefined),
  });
}

function action(body: URLSearchParams) {
  return clientAction({
    request: new Request("https://example.com/groups/test", {
      method: "POST",
      body,
    }),
    params: { slug: "test" },
    context: new RouterContextProvider(),
    url: new URL("https://example.com/groups/test"),
    pattern: "/groups/:slug",
    serverAction: () => Promise.resolve(undefined),
  });
}

describe("group detail management action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getQueryClient().clear();
  });

  it("dispatches member moderation and ownership intents", async () => {
    await action(
      new URLSearchParams({
        intent: "approve-join-request",
        groupId: "group",
        requestId: "request",
      }),
    );
    await action(
      new URLSearchParams({
        intent: "set-member-role",
        groupId: "group",
        memberId: "member",
        role: "manager",
      }),
    );
    await action(
      new URLSearchParams({
        intent: "transfer-ownership",
        groupId: "group",
        memberId: "admin",
      }),
    );

    expect(mutations.approveGroupJoinRequest).toHaveBeenCalledWith(
      "group",
      "request",
    );
    expect(mutations.setGroupMemberRole).toHaveBeenCalledWith(
      "group",
      "member",
      "manager",
    );
    expect(mutations.transferGroupOwnership).toHaveBeenCalledWith(
      "group",
      "admin",
    );
  });

  it("validates and dispatches settings", async () => {
    const result = await action(
      new URLSearchParams({
        intent: "update-settings",
        groupId: "group",
        name: "새 이름",
        description: "설명",
        joinPolicy: "request",
        identityPolicy: "optional_anonymous",
        postingPolicy: "staff",
      }),
    );
    expect(result).toMatchObject({ data: { ok: true } });
    expect(mutations.updateGroupSettings).toHaveBeenCalledWith("group", {
      name: "새 이름",
      description: "설명",
      joinPolicy: "request",
      identityPolicy: "optional_anonymous",
      postingPolicy: "staff",
    });
  });

  it("rejects an owner role through the ordinary role action", async () => {
    const result = await action(
      new URLSearchParams({
        intent: "set-member-role",
        groupId: "group",
        memberId: "member",
        role: "owner",
      }),
    );
    expect(result).toMatchObject({ init: { status: 400 } });
    expect(mutations.setGroupMemberRole).not.toHaveBeenCalled();
  });

  it.each([
    ["   ", "설명"],
    ["가".repeat(51), "설명"],
    ["이름", "가".repeat(2001)],
  ])("rejects invalid settings lengths", async (name, description) => {
    const result = await action(
      new URLSearchParams({
        intent: "update-settings",
        groupId: "group",
        name,
        description,
        joinPolicy: "request",
        identityPolicy: "identified",
        postingPolicy: "members",
      }),
    );

    expect(result).toMatchObject({ init: { status: 400 } });
    expect(mutations.updateGroupSettings).not.toHaveBeenCalled();
  });
});

describe("group detail loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getQueryClient().clear();
    mutations.loadGroupDetail.mockResolvedValue(group);
    mutations.listGroupCategories.mockResolvedValue([]);
  });

  it("loads the background post list for a direct post detail", async () => {
    const page = { posts: [{ post_id: "post-id" }], nextCursor: null };
    mutations.listGroupPosts.mockResolvedValue(page);

    const result = await load("/groups/test/posts/post-id");

    expect(mutations.listGroupPosts).toHaveBeenCalledWith("group-id", {
      hydrateMedia: expect.any(Boolean),
    });
    expect(result.posts).toBe(page);
  });

  it("returns a refreshed post list while a detail modal is open", async () => {
    const initialPage = {
      posts: [{ post_id: "old-post" }],
      nextCursor: null,
    };
    const refreshedPage = {
      posts: [{ post_id: "new-post" }, { post_id: "old-post" }],
      nextCursor: null,
    };
    mutations.listGroupPosts
      .mockResolvedValueOnce(initialPage)
      .mockResolvedValueOnce(refreshedPage);

    await load("/groups/test");
    await getQueryClient().invalidateQueries({
      queryKey: groupKeys.postPages("group-id"),
      refetchType: "none",
    });
    const result = await load("/groups/test/posts/new-post");

    expect(mutations.listGroupPosts).toHaveBeenCalledTimes(2);
    expect(result.posts).toBe(refreshedPage);
  });
});

/**
 * 규칙 자체는 `createPostListRevalidation`의 테스트가 확인한다. 이 route에만 있는 사실은
 * 검색 오버레이 파라미터(`search`, `q`)만 UI 전용으로 넘겼다는 것이라, 여기서는 그 목록이
 * 맞는지만 본다 — loader가 읽는 `tab`은 그 목록에 없어야 한다.
 */
describe("group detail revalidation", () => {
  it("ignores only the search overlay parameters", () => {
    expect(
      shouldRevalidate({
        currentUrl: new URL("https://example.com/groups/test?tab=members"),
        nextUrl: new URL(
          "https://example.com/groups/test?tab=members&search=1&q=%EC%8B%9C%ED%97%98",
        ),
      } as never),
    ).toBe(false);
    expect(
      shouldRevalidate({
        currentUrl: new URL("https://example.com/groups/test?search=1"),
        nextUrl: new URL("https://example.com/groups/test?tab=members"),
      } as never),
    ).toBe(true);
  });

  it("preserves the parent snapshot when opening and closing a post", () => {
    expect(
      shouldRevalidate({
        currentUrl: new URL("https://example.com/groups/test"),
        nextUrl: new URL("https://example.com/groups/test/posts/post-id"),
      } as never),
    ).toBe(false);
    expect(
      shouldRevalidate({
        currentUrl: new URL("https://example.com/groups/test/posts/post-id"),
        nextUrl: new URL("https://example.com/groups/test"),
      } as never),
    ).toBe(false);
  });

  it("allows an explicit refresh while a post is open", () => {
    const url = new URL("https://example.com/groups/test/posts/post-id");
    expect(shouldRevalidate({ currentUrl: url, nextUrl: url } as never)).toBe(
      true,
    );
  });
});
