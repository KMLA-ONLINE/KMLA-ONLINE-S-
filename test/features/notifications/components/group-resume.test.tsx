import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, Outlet, useLoaderData } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { listGroupPosts as listGroupPostsQuery } from "~/features/posts/data/queries";

const mocks = vi.hoisted(() => ({
  loadGroupDetail: vi.fn(),
  listGroupPosts: vi.fn<typeof listGroupPostsQuery>(),
  listGroupFeaturedPosts: vi.fn(() => Promise.resolve([])),
  listGroupCategories: vi.fn(),
}));
vi.mock("~/features/groups/data/queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadGroupDetail: mocks.loadGroupDetail,
}));
vi.mock("~/features/groups/data/mutations", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  markGroupPostsVisited: () => Promise.resolve(),
}));
vi.mock("~/features/posts/data/queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listGroupPosts: mocks.listGroupPosts,
  listGroupFeaturedPosts: mocks.listGroupFeaturedPosts,
  listGroupCategories: mocks.listGroupCategories,
}));
vi.mock("~/features/notifications/data/queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getRecentUnreadNotificationCount: () => Promise.resolve(0),
}));
vi.mock("~/features/notifications/data/subscriptions", () => ({
  subscribeToNotifications: () => () => undefined,
}));
vi.mock("~/features/notifications/data/push", () => ({
  resyncWebPushSubscription: () => Promise.resolve(),
}));
vi.mock("~/shared/lib/app-badge", () => ({
  setAppBadgeCount: () => undefined,
}));

import { groupKeys } from "~/features/groups/data/cache";
import type { GroupDetail } from "~/features/groups/model/types";
import { NotificationSync } from "~/features/notifications/components/notification-sync";
import { GroupPostsPanel } from "~/features/posts/components/group/group-posts-panel";
import type { GroupPost, GroupPostPage } from "~/features/posts/model/types";
import { writePostViewMode } from "~/features/posts/model/view-preference";
import { clientLoader } from "~/routes/app/groups/detail";
import { getQueryClient } from "~/shared/lib/query-client";

const group: GroupDetail = {
  id: "group-id",
  group_id: "group-id",
  slug: "club",
  name: "그룹",
  description: "",
  kind: "unofficial",
  join_policy: "request",
  identity_policy: "identified",
  posting_policy: "members",
  icon_path: null,
  cover_path: null,
  member_count: 3,
  hide_staff_roles: false,
  membership_state: "member",
  member_role: "member",
  pinned_at: null,
  requested_at: null,
};
const post = (post_id: string, title: string): GroupPost => ({
  post_id,
  title,
  body: "",
  attachments: [],
  mentions: [],
  group_id: group.group_id,
  category_id: "category",
  category_name: "공지",
  published_at: "2026-10-13T00:00:00Z",
  edited_at: "",
  author_identity: "anonymous",
  author_label: "익명",
  author_pub_id: "",
  author_name: "",
  author_avatar_path: null,
  author_avatar_url: null,
  is_author: false,
  is_pinned: false,
  is_featured: false,
  can_edit: false,
  can_delete: false,
  can_pin: false,
  can_moderate_anonymous: false,
  anonymous_author_restricted: false,
  anonymous_author_restriction_expires_at: null,
  comment_count: 0,
  reaction_count: 0,
  top_reactions: [],
  my_reaction: null,
});
const cursor = (postId: string) => ({
  postId,
  publishedAt: "2026-10-13T00:00:00Z",
  isPinned: false,
});
let observerCallback: IntersectionObserverCallback | null;

function GroupScreen() {
  const data = useLoaderData<typeof clientLoader>();
  if (data.group.membership_state !== "member") return <p>멤버 전용 콘텐츠</p>;
  if (data.posts instanceof Promise)
    throw new Error("expected the group's exact route");
  return (
    <GroupPostsPanel
      groupId={data.group.group_id}
      slug={data.group.slug}
      categories={data.categories}
      initialPage={data.posts}
    />
  );
}
function renderGroup() {
  const client = getQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <>
          <NotificationSync profileId={7} />
          <Outlet />
        </>
      ),
      children: [
        {
          id: "routes/app/groups/detail",
          path: "groups/:slug",
          Component: GroupScreen,
          loader: ({ params, request }) =>
            clientLoader({ params, request } as Parameters<
              typeof clientLoader
            >[0]),
        },
      ],
    },
  ]);
  render(
    <QueryClientProvider client={client}>
      <Stub initialEntries={["/groups/club"]} />
    </QueryClientProvider>,
  );
  return { client, user: userEvent.setup() };
}
function intersect() {
  if (!observerCallback) throw new Error("sentinel is not observed");
  observerCallback(
    [{ isIntersecting: true } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  observerCallback = null;
  writePostViewMode("list");
  mocks.loadGroupDetail.mockResolvedValue(group);
  mocks.listGroupCategories.mockResolvedValue([
    {
      id: "category",
      group_id: group.group_id,
      name: "공지",
      position: 0,
      created_at: "",
      updated_at: "",
    },
  ]);
  mocks.listGroupPosts.mockImplementation((_, options) =>
    Promise.resolve({
      posts: [
        options?.cursor?.postId === "second"
          ? post("third", "세 번째")
          : options?.cursor
            ? post("second", "두 번째")
            : post("first", "첫 번째"),
      ],
      nextCursor:
        options?.cursor?.postId === "second"
          ? null
          : cursor(options?.cursor ? "second" : "first"),
    }),
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe() {
        observerCallback = this.callback;
      }
      disconnect() {
        if (observerCallback === this.callback) observerCallback = null;
      }
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  writePostViewMode("card");
});

it("keeps three loaded pages and the selected category after returning with expired caches", async () => {
  const { client, user } = renderGroup();
  await user.click(await screen.findByRole("button", { name: "공지" }));
  await waitFor(() => expect(observerCallback).not.toBeNull());
  act(() => {
    intersect();
  });
  const second = await screen.findByText("두 번째");
  await waitFor(() => expect(observerCallback).not.toBeNull());
  act(() => {
    intersect();
  });
  const third = await screen.findByText("세 번째");
  const calls = mocks.listGroupPosts.mock.calls.length;
  for (const query of client
    .getQueryCache()
    .findAll({ queryKey: groupKeys.postPages(group.group_id) })) {
    client.setQueryData(query.queryKey, query.state.data, {
      updatedAt: Date.now() - 180_000,
    });
  }
  // A count/name change is not an access-policy change either.
  mocks.loadGroupDetail.mockResolvedValueOnce({
    ...group,
    member_count: 4,
    name: "새 이름",
  });
  act(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await waitFor(() => expect(mocks.loadGroupDetail).toHaveBeenCalledTimes(2));
  expect(screen.getByText("두 번째")).toBe(second);
  expect(screen.getByText("세 번째")).toBe(third);
  expect(screen.getAllByRole("link")).toHaveLength(3);
  expect(screen.getByRole("button", { name: "공지" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(mocks.listGroupPosts).toHaveBeenCalledTimes(calls);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("hides loaded posts after membership is revoked on return", async () => {
  renderGroup();
  await screen.findByText("첫 번째");
  mocks.loadGroupDetail.mockResolvedValueOnce({
    ...group,
    membership_state: "none",
    member_role: null,
  });
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(await screen.findByText("멤버 전용 콘텐츠")).toBeVisible();
  expect(screen.queryByText("첫 번째")).not.toBeInTheDocument();
});

it("allows an in-flight next page to finish after an unchanged-access return", async () => {
  renderGroup();
  await screen.findByText("첫 번째");
  let resolve!: (page: GroupPostPage) => void;
  mocks.listGroupPosts.mockImplementationOnce(
    () =>
      new Promise<GroupPostPage>((next) => {
        resolve = next;
      }),
  );
  act(() => {
    intersect();
  });
  expect(screen.getByRole("status")).toBeVisible();
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await waitFor(() => expect(mocks.loadGroupDetail).toHaveBeenCalledTimes(2));
  await act(async () => {
    resolve({ posts: [post("second", "두 번째")], nextCursor: null });
    await Promise.resolve();
  });
  expect(await screen.findByText("두 번째")).toBeVisible();
  expect(screen.getAllByRole("link")).toHaveLength(2);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
