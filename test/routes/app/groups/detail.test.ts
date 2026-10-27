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
  listGroupFeaturedPosts: vi.fn(),
  setGroupPostFeatured: vi.fn(),
  leaveGroup: vi.fn(),
}));
const visits = vi.hoisted(() => ({ markGroupPostsVisited: vi.fn() }));

vi.mock("~/features/groups", async (importOriginal) => ({
  ...(await importOriginal()),
  ...mutations,
}));

// 방문 기록은 groups의 캐시 helper가 부른다. 공개 API가 아니라 모듈을 바꾼다.
vi.mock("~/features/groups/data/mutations", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...visits,
}));

// 대표 쿼리는 posts의 cache 모듈이 data/queries를 직접 부른다. 공개 API만 바꾸면 닿지 않는다.
vi.mock("~/features/posts/data/queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listGroupFeaturedPosts: mutations.listGroupFeaturedPosts,
}));

vi.mock("~/features/posts", async (importOriginal) => ({
  ...(await importOriginal()),
  listGroupCategories: mutations.listGroupCategories,
  listGroupPosts: mutations.listGroupPosts,
  listGroupFeaturedPosts: mutations.listGroupFeaturedPosts,
  setGroupPostFeatured: mutations.setGroupPostFeatured,
}));

import { groupKeys } from "~/features/groups";
import { postKeys } from "~/features/posts";
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
  hide_staff_roles: false,
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

  it("dispatches featuring and unfeaturing", async () => {
    mutations.setGroupPostFeatured.mockResolvedValue("post");
    await action(
      new URLSearchParams({
        intent: "feature-post",
        groupId: "group",
        postId: "post",
        featured: "true",
      }),
    );
    expect(mutations.setGroupPostFeatured).toHaveBeenCalledWith("post", true);

    await action(
      new URLSearchParams({
        intent: "feature-post",
        groupId: "group",
        postId: "post",
        featured: "false",
      }),
    );
    expect(mutations.setGroupPostFeatured).toHaveBeenLastCalledWith(
      "post",
      false,
    );
  });

  // 대표 목록 캐시는 2분간 신선하다. 무효화하지 않으면 재검증한 loader가 옛 캐러셀을 돌려준다.
  it("marks the featured list stale after featuring", async () => {
    mutations.setGroupPostFeatured.mockResolvedValue("post");
    getQueryClient().setQueryData(groupKeys.featuredPosts("group"), []);
    await action(
      new URLSearchParams({
        intent: "feature-post",
        groupId: "group",
        postId: "post",
        featured: "true",
      }),
    );
    expect(
      getQueryClient().getQueryState(groupKeys.featuredPosts("group"))
        ?.isInvalidated,
    ).toBe(true);
  });

  // 대표 지정은 목록 순서를 바꾸지 않는다. 첫 페이지까지 다시 받으면 패널이 골라 둔 카테고리와 더
  // 불러온 글을 버린다.
  it("leaves the post list fresh after featuring", async () => {
    mutations.setGroupPostFeatured.mockResolvedValue("post");
    const listKey = groupKeys.posts("group", null, null);
    getQueryClient().setQueryData(listKey, { posts: [], nextCursor: null });
    await action(
      new URLSearchParams({
        intent: "feature-post",
        groupId: "group",
        postId: "post",
        featured: "true",
      }),
    );
    expect(getQueryClient().getQueryState(listKey)?.isInvalidated).toBe(false);
  });

  it("validates and dispatches settings", async () => {
    const result = await action(
      new URLSearchParams({
        intent: "update-settings",
        settingsSection: "posting",
        groupId: "group",
        name: "새 이름",
        description: "설명",
        joinPolicy: "request",
        identityPolicy: "optional_anonymous",
        postingPolicy: "staff",
        hideStaffRoles: "true",
      }),
    );
    expect(result).toMatchObject({ data: { ok: true } });
    expect(mutations.updateGroupSettings).toHaveBeenCalledWith("group", {
      name: "새 이름",
      description: "설명",
      joinPolicy: "request",
      identityPolicy: "optional_anonymous",
      postingPolicy: "staff",
      hideStaffRoles: true,
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
        settingsSection: "posting",
        groupId: "group",
        name,
        description,
        joinPolicy: "request",
        identityPolicy: "identified",
        postingPolicy: "members",
        hideStaffRoles: "false",
      }),
    );

    expect(result).toMatchObject({ init: { status: 400 } });
    expect(mutations.updateGroupSettings).not.toHaveBeenCalled();
  });
});

const shownPage = {
  posts: [
    { published_at: "2026-10-19T08:00:00+00:00" },
    { published_at: "2026-10-19T09:00:00.123456+00:00" },
    { published_at: "2026-10-19T09:00:00.12+00:00" },
  ],
  nextCursor: null,
};

describe("group detail loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getQueryClient().clear();
    mutations.loadGroupDetail.mockResolvedValue(group);
    mutations.listGroupCategories.mockResolvedValue([]);
    mutations.listGroupFeaturedPosts.mockResolvedValue([]);
    visits.markGroupPostsVisited.mockResolvedValue(undefined);
  });

  // 목록은 그룹 ID만 있으면 된다. 아이콘·커버 서명 왕복이 끝나기를 기다리면 그만큼 늦게 출발한다.
  it("starts the post list before the group media is signed", async () => {
    let finishDetail: (value: typeof group) => void = () => undefined;
    mutations.loadGroupDetail.mockImplementation(
      (
        _slug: string,
        options: {
          onFound?: (row: {
            group_id: string;
            membership_state: string;
          }) => void;
        },
      ) => {
        options.onFound?.({ group_id: "group-id", membership_state: "member" });
        return new Promise((resolve) => {
          finishDetail = resolve;
        });
      },
    );
    mutations.listGroupPosts.mockResolvedValue({ posts: [], nextCursor: null });

    const loading = load("/groups/test");
    await vi.waitFor(() => {
      expect(mutations.listGroupPosts).toHaveBeenCalledOnce();
    });
    expect(mutations.listGroupCategories).toHaveBeenCalledOnce();

    finishDetail(group);
    await loading;
    // 진행 중이던 요청을 이어받는다. 같은 목록을 두 번 부르지 않는다.
    expect(mutations.listGroupPosts).toHaveBeenCalledOnce();
    expect(mutations.listGroupCategories).toHaveBeenCalledOnce();
  });

  it("loads the background post list for a direct post detail", async () => {
    const page = { posts: [{ post_id: "post-id" }], nextCursor: null };
    mutations.listGroupPosts.mockResolvedValue(page);

    const result = await load("/groups/test/posts/post-id");

    expect(mutations.listGroupPosts).toHaveBeenCalledWith("group-id", {
      hydrateMedia: expect.any(Boolean),
    });
    expect(result.posts).toBeInstanceOf(Promise);
    await expect(result.posts).resolves.toEqual({
      page,
      categories: [],
    });
  });

  // 대표 섹션은 접혀 시작한다. 목록과 함께 출발시키되 게시물 탭이 그것을 기다리면 안 된다.
  it("starts the featured list without holding the group page on it", async () => {
    mutations.listGroupPosts.mockResolvedValue({ posts: [], nextCursor: null });
    mutations.listGroupFeaturedPosts.mockReturnValue(
      new Promise(() => undefined),
    );

    const result = await load("/groups/test");

    expect(mutations.listGroupFeaturedPosts).toHaveBeenCalledWith("group-id");
    expect(result.posts).toEqual({ posts: [], nextCursor: null });
  });

  // 캐러셀은 곁들이다. 그것 때문에 그룹 화면 전체가 에러 화면이 되면 안 된다.
  it("keeps the group page when the featured list fails", async () => {
    mutations.listGroupPosts.mockResolvedValue({ posts: [], nextCursor: null });
    mutations.listGroupFeaturedPosts.mockRejectedValue(new Error("boom"));

    const result = await load("/groups/test");

    expect(result.posts).toEqual({ posts: [], nextCursor: null });
  });

  it("skips featured posts on the other tabs", async () => {
    await load("/groups/test?tab=settings");
    expect(mutations.listGroupFeaturedPosts).not.toHaveBeenCalled();
  });

  // 상세는 카테고리를 쓰지 않는다. 글쓰기·수정은 부모의 카테고리를 그대로 쓰므로 기다린다.
  it("waits for categories only on the editor child routes", async () => {
    const category = { id: "category-id", name: "공지" };
    mutations.listGroupPosts.mockResolvedValue({ posts: [], nextCursor: null });
    mutations.listGroupCategories.mockReturnValue(new Promise(() => undefined));

    const detail = await load("/groups/test/posts/post-id");
    expect(detail.categories).toEqual([]);

    getQueryClient().clear();
    mutations.listGroupCategories.mockResolvedValue([category]);
    const editor = await load("/groups/test/posts/post-id/edit");
    expect(editor.categories).toEqual([category]);
  });

  // 목록은 dialog 뒤에 깔릴 뿐이라, 상세가 목록 RPC를 기다리면 열리는 시간이 그만큼 늘어난다.
  it("does not hold a direct post detail on the post list", async () => {
    mutations.listGroupPosts.mockReturnValue(new Promise(() => undefined));

    const result = await load("/groups/test/posts/post-id");

    expect(result.group).toBe(group);
    expect(result.posts).toBeInstanceOf(Promise);
  });

  it("keeps a direct post detail when the background post list fails", async () => {
    mutations.listGroupPosts.mockRejectedValue(new Error("offline"));

    const result = await load("/groups/test/posts/post-id");

    await expect(result.posts).resolves.toBeNull();
  });

  it("marks posts visited only when the group post list itself loads", async () => {
    mutations.listGroupPosts.mockResolvedValue(shownPage);

    await load("/groups/test/posts/post-id");
    expect(visits.markGroupPostsVisited).not.toHaveBeenCalled();

    await load("/groups/test");
    expect(visits.markGroupPostsVisited).toHaveBeenCalledWith(
      "group-id",
      "2026-10-19T09:00:00.123456+00:00",
    );
  });

  it("leaves the watermark alone for an empty post list", async () => {
    mutations.listGroupPosts.mockResolvedValue({ posts: [], nextCursor: null });

    await load("/groups/test");

    expect(visits.markGroupPostsVisited).not.toHaveBeenCalled();
  });

  it("clears this group's count without waiting for the visit RPC", async () => {
    mutations.listGroupPosts.mockResolvedValue(shownPage);
    // 끝나지 않는 RPC — 숫자는 응답을 기다리지 않고 내려가야 한다.
    visits.markGroupPostsVisited.mockReturnValue(
      new Promise<void>(() => undefined),
    );
    const queryClient = getQueryClient();
    queryClient.setQueryData(groupKeys.newPostCounts(), {
      "group-id": 3,
      "other-id": 5,
    });

    await load("/groups/test");

    expect(queryClient.getQueryData(groupKeys.newPostCounts())).toEqual({
      "group-id": 0,
      "other-id": 5,
    });
  });

  // 보여 준 글보다 늦게 올라온 글은 남는다. 서버 값으로 바로잡는다.
  it.each([
    ["succeeds", () => Promise.resolve()],
    ["fails", () => Promise.reject(new Error("offline"))],
  ])("re-reads the counts when the visit RPC %s", async (_, visit) => {
    mutations.listGroupPosts.mockResolvedValue(shownPage);
    visits.markGroupPostsVisited.mockImplementation(visit);
    const queryClient = getQueryClient();
    queryClient.setQueryData(groupKeys.newPostCounts(), { "group-id": 3 });

    await load("/groups/test");
    await vi.waitFor(() =>
      expect(
        queryClient.getQueryState(groupKeys.newPostCounts())?.isInvalidated,
      ).toBe(true),
    );
  });

  it("keeps a cached post list the counts have caught up with", async () => {
    mutations.listGroupPosts.mockResolvedValue(shownPage);
    await load("/groups/test");
    getQueryClient().setQueryData(groupKeys.newPostCounts(), {
      "group-id": 0,
    });
    mutations.listGroupPosts.mockClear();

    await load("/groups/test");

    expect(mutations.listGroupPosts).not.toHaveBeenCalled();
  });

  it.each([
    ["has new posts", { "group-id": 2 }, 0],
    ["has no counts", undefined, 0],
    ["has counts read before the list", { "group-id": 0 }, -1],
  ])(
    "refetches a cached post list when the group %s",
    async (_, counts, countsAge) => {
      mutations.listGroupPosts.mockResolvedValue(shownPage);
      const queryClient = getQueryClient();
      await load("/groups/test");
      const listedAt =
        queryClient.getQueryState(groupKeys.posts("group-id", null, null))
          ?.dataUpdatedAt ?? 0;
      queryClient.removeQueries({ queryKey: groupKeys.newPostCounts() });
      if (counts) {
        queryClient.setQueryData(groupKeys.newPostCounts(), counts, {
          updatedAt: listedAt + (countsAge < 0 ? -1 : 1),
        });
      }
      mutations.listGroupPosts.mockClear();

      await load("/groups/test");

      expect(mutations.listGroupPosts).toHaveBeenCalledTimes(1);
    },
  );

  // 반응·고정 뒤의 재검증은 같은 목록을 다시 그린다. 기준이 그대로면 RPC도 새 글 수 무효화도 없다.
  it("does not re-send an unchanged watermark", async () => {
    mutations.listGroupPosts.mockResolvedValue(shownPage);
    const queryClient = getQueryClient();
    queryClient.setQueryData(groupKeys.newPostCounts(), { "group-id": 0 });

    await load("/groups/test");
    await load("/groups/test");

    expect(visits.markGroupPostsVisited).toHaveBeenCalledTimes(1);
  });

  it("re-sends the watermark after a failed visit", async () => {
    mutations.listGroupPosts.mockResolvedValue(shownPage);
    visits.markGroupPostsVisited.mockRejectedValueOnce(new Error("offline"));
    const queryClient = getQueryClient();
    queryClient.setQueryData(groupKeys.newPostCounts(), { "group-id": 0 });

    await load("/groups/test");
    await vi.waitFor(() =>
      expect(
        queryClient.getQueryData(groupKeys.postsSeenUntil("group-id")),
      ).toBeUndefined(),
    );
    await load("/groups/test");

    expect(visits.markGroupPostsVisited).toHaveBeenCalledTimes(2);
  });

  it("does not block optional-anonymous group content on a restriction lookup", async () => {
    mutations.loadGroupDetail.mockResolvedValue({
      ...group,
      identity_policy: "optional_anonymous",
    });
    mutations.listGroupPosts.mockResolvedValue({ posts: [], nextCursor: null });

    const result = await load("/groups/test");

    expect(result.posts).toEqual({ posts: [], nextCursor: null });
    expect(result).not.toHaveProperty("anonymousActivityRestriction");
  });

  it("checks current membership again after a focused group route invalidates access cache", async () => {
    await load("/groups/test");
    await getQueryClient().invalidateQueries({
      queryKey: groupKeys.all,
      refetchType: "none",
    });

    await load("/groups/test");

    expect(mutations.loadGroupDetail).toHaveBeenCalledTimes(2);
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
    await expect(result.posts).resolves.toEqual({
      page: refreshedPage,
      categories: [],
    });
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

describe("leaving a group", () => {
  it("makes message post cards re-check access after leaving", async () => {
    mutations.leaveGroup.mockResolvedValue(true);
    const queryClient = getQueryClient();
    queryClient.setQueryData(postKeys.preview("group-post"), null);

    await action(
      new URLSearchParams({
        intent: "leave",
        groupId: "group-id",
        profileId: "1",
      }),
    ).catch((response: unknown) => response);

    expect(mutations.leaveGroup).toHaveBeenCalledWith("group-id", 1);
    expect(
      queryClient.getQueryState(postKeys.preview("group-post"))?.isInvalidated,
    ).toBe(true);
  });
});
