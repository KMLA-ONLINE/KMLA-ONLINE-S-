import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidate: vi.fn(),
  subscribeToNotifications: vi.fn(),
  getRecentUnreadNotificationCount: vi.fn(() => Promise.resolve(0)),
  resyncWebPushSubscription: vi.fn(() => Promise.resolve()),
  loadGroupDetail: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRevalidator: () => ({ revalidate: mocks.revalidate }),
}));

vi.mock("~/features/notifications/data/subscriptions", () => ({
  subscribeToNotifications: mocks.subscribeToNotifications,
}));

vi.mock("~/features/notifications/data/queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getRecentUnreadNotificationCount: mocks.getRecentUnreadNotificationCount,
}));

vi.mock("~/features/notifications/data/push", () => ({
  resyncWebPushSubscription: mocks.resyncWebPushSubscription,
}));

vi.mock("~/features/groups/data/queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadGroupDetail: mocks.loadGroupDetail,
}));

import { groupKeys } from "~/features/groups/data/cache";
import type { GroupDetail } from "~/features/groups/model/types";
import { NotificationSync } from "~/features/notifications/components/notification-sync";
import { notificationKeys } from "~/features/notifications/data/cache";

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const group: GroupDetail = {
  id: "group-id",
  group_id: "group-id",
  slug: "private-club",
  name: "그룹",
  description: "",
  kind: "unofficial",
  join_policy: "request",
  identity_policy: "identified",
  posting_policy: "members",
  hide_staff_roles: false,
  icon_path: null,
  cover_path: null,
  member_count: 3,
  membership_state: "member",
  member_role: "member",
  pinned_at: null,
  requested_at: null,
};

function renderSync(pathname: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  mocks.subscribeToNotifications.mockReturnValue(() => undefined);
  queryClient.setQueryData(groupKeys.detail(group.slug), group);
  mocks.loadGroupDetail.mockResolvedValue(group);
  const Stub = createRoutesStub([
    {
      id: "routes/app/groups/detail",
      path: "*",
      loader: () => ({ group }),
      Component: () => <NotificationSync profileId={7} />,
    },
  ]);

  const view = render(
    <QueryClientProvider client={queryClient}>
      <Stub
        initialEntries={[pathname]}
        hydrationData={{
          loaderData: { "routes/app/groups/detail": { group } },
        }}
      />
    </QueryClientProvider>,
  );

  return { invalidateQueries, queryClient, unmount: view.unmount };
}

describe("NotificationSync", () => {
  it("preserves even expired post pages when access is unchanged on focus", async () => {
    const { invalidateQueries, queryClient } = renderSync(
      "/groups/private-club",
    );
    const pages = {
      posts: [
        { post_id: "first" },
        { post_id: "second" },
        { post_id: "third" },
      ],
    };
    const key = groupKeys.posts(group.group_id, null);
    queryClient.setQueryData(key, pages, { updatedAt: Date.now() - 180_000 });

    await waitFor(() =>
      expect(mocks.subscribeToNotifications).toHaveBeenCalledWith(
        7,
        expect.any(Function),
      ),
    );
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(mocks.loadGroupDetail).toHaveBeenCalledOnce());
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: notificationKeys.badge(),
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: groupKeys.all,
      refetchType: "none",
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(key)).toBe(pages);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("does not revalidate a group route for an unrelated notification event", async () => {
    renderSync("/groups/private-club");

    await waitFor(() =>
      expect(mocks.subscribeToNotifications).toHaveBeenCalledOnce(),
    );
    const onChange = mocks.subscribeToNotifications.mock
      .calls[0][1] as () => void;
    onChange();

    await waitFor(() => expect(mocks.revalidate).not.toHaveBeenCalled());
  });

  it("coalesces a burst of inbox notification events into one revalidation", async () => {
    renderSync("/noti");

    await waitFor(() =>
      expect(mocks.subscribeToNotifications).toHaveBeenCalledOnce(),
    );
    const onChange = mocks.subscribeToNotifications.mock
      .calls[0][1] as () => void;
    onChange();
    onChange();
    onChange();

    await waitFor(() => expect(mocks.revalidate).toHaveBeenCalledOnce());
  });

  it("refreshes the badge once for a burst of notification events", async () => {
    const { invalidateQueries } = renderSync("/");

    await waitFor(() =>
      expect(mocks.subscribeToNotifications).toHaveBeenCalledOnce(),
    );
    const onChange = mocks.subscribeToNotifications.mock
      .calls[0][1] as () => void;
    // `모두 읽음` 한 번이 바뀐 행마다 Realtime 신호로 온다.
    for (let index = 0; index < 20; index += 1) onChange();

    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: notificationKeys.badge(),
      }),
    );
    expect(
      invalidateQueries.mock.calls.filter(
        ([filters]) =>
          JSON.stringify(filters?.queryKey) ===
          JSON.stringify(notificationKeys.badge()),
      ),
    ).toHaveLength(1);
  });

  it("treats becoming visible again as a return, not only window focus", async () => {
    const { invalidateQueries } = renderSync("/groups/private-club");

    await waitFor(() =>
      expect(mocks.subscribeToNotifications).toHaveBeenCalledOnce(),
    );
    // 설치형 PWA를 배경에서 되살릴 때 `focus` 없이 이것만 오는 경우가 있다.
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: notificationKeys.badge(),
      }),
    );
    await waitFor(() => expect(mocks.loadGroupDetail).toHaveBeenCalledOnce());
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("coalesces focus and visibilitychange from one return into a single sync", async () => {
    renderSync("/groups/private-club");

    await waitFor(() =>
      expect(mocks.subscribeToNotifications).toHaveBeenCalledOnce(),
    );
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => expect(mocks.loadGroupDetail).toHaveBeenCalledOnce());
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("marks protected group pages stale and revalidates when membership is revoked", async () => {
    const { queryClient } = renderSync("/groups/private-club/posts/post-id");
    const firstKey = groupKeys.posts(group.group_id, null);
    const nextKey = groupKeys.posts(group.group_id, "category");
    const otherKey = groupKeys.posts("other-group", null);
    queryClient.setQueryData(firstKey, { posts: ["protected"] });
    queryClient.setQueryData(nextKey, { posts: ["more protected"] });
    queryClient.setQueryData(groupKeys.invite(group.group_id), {
      token: "protected",
    });
    queryClient.setQueryData(otherKey, { posts: ["other"] });
    const revoked: GroupDetail = {
      ...group,
      membership_state: "none",
      member_role: null,
    };
    mocks.loadGroupDetail.mockResolvedValueOnce(revoked);
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(mocks.revalidate).toHaveBeenCalledOnce());
    expect(queryClient.getQueryState(firstKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(nextKey)?.isInvalidated).toBe(true);
    expect(
      queryClient.getQueryState(groupKeys.invite(group.group_id))
        ?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryData(groupKeys.detail(group.slug))).toEqual(
      revoked,
    );
  });

  it("keeps the screen and cached pages when the access check fails", async () => {
    const { queryClient } = renderSync("/groups/private-club");
    const key = groupKeys.posts(group.group_id, null);
    const page = { posts: ["loaded page"] };
    queryClient.setQueryData(key, page);
    await waitFor(() =>
      expect(mocks.subscribeToNotifications).toHaveBeenCalledOnce(),
    );
    mocks.loadGroupDetail.mockRejectedValueOnce(new Error("offline"));
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(mocks.loadGroupDetail).toHaveBeenCalledOnce());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(key)).toBe(page);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1_000);
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(mocks.loadGroupDetail).toHaveBeenCalledTimes(2));
  });

  it("releases a hung access check so a later return checks again", async () => {
    renderSync("/groups/private-club");
    await waitFor(() =>
      expect(mocks.subscribeToNotifications).toHaveBeenCalledOnce(),
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      mocks.loadGroupDetail.mockImplementationOnce(
        () => new Promise<GroupDetail>(() => undefined),
      );
      window.dispatchEvent(new Event("focus"));
      await vi.waitFor(() =>
        expect(mocks.loadGroupDetail).toHaveBeenCalledOnce(),
      );
      vi.advanceTimersByTime(10_000);
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1_000);
      window.dispatchEvent(new Event("focus"));
      await vi.waitFor(() =>
        expect(mocks.loadGroupDetail).toHaveBeenCalledTimes(2),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["members", "reports", "settings"])(
    "refreshes the %s tab on return even when access is unchanged",
    async (tab) => {
      const { queryClient } = renderSync(`/groups/private-club?tab=${tab}`);
      const key = groupKeys.memberLists(group.group_id);
      queryClient.setQueryData(key, ["member"]);
      await waitFor(() =>
        expect(mocks.subscribeToNotifications).toHaveBeenCalledOnce(),
      );
      window.dispatchEvent(new Event("focus"));
      await waitFor(() => expect(mocks.revalidate).toHaveBeenCalledOnce());
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    },
  );

  it("preserves pages even after the inactive detail cache has been collected", async () => {
    const { queryClient } = renderSync("/groups/private-club");
    await waitFor(() =>
      expect(mocks.subscribeToNotifications).toHaveBeenCalledOnce(),
    );
    queryClient.removeQueries({
      queryKey: groupKeys.detail(group.slug),
      exact: true,
    });
    const key = groupKeys.posts(group.group_id, null);
    const page = { posts: ["loaded page"] };
    queryClient.setQueryData(key, page);
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(mocks.loadGroupDetail).toHaveBeenCalledOnce());
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(key)).toBe(page);
  });

  it.each([
    { member_role: "admin" },
    { posting_policy: "staff" },
    { identity_policy: "optional_anonymous" },
    { join_policy: "invite_only" },
    { hide_staff_roles: true },
  ] satisfies Partial<GroupDetail>[])(
    "refreshes screen permissions when %j changes",
    async (change) => {
      const { queryClient } = renderSync("/groups/private-club");
      const key = groupKeys.posts(group.group_id, null);
      queryClient.setQueryData(key, { posts: ["outdated permissions"] });
      mocks.loadGroupDetail.mockResolvedValueOnce({ ...group, ...change });
      window.dispatchEvent(new Event("focus"));
      await waitFor(() => expect(mocks.revalidate).toHaveBeenCalledOnce());
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    },
  );

  it("revalidates a deleted group and marks its protected pages stale", async () => {
    const { queryClient } = renderSync("/groups/private-club");
    const key = groupKeys.posts(group.group_id, null);
    queryClient.setQueryData(key, { posts: ["deleted group"] });
    mocks.loadGroupDetail.mockResolvedValueOnce(null);
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(mocks.revalidate).toHaveBeenCalledOnce());
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(groupKeys.detail(group.slug))).toBeNull();
  });

  it("coalesces returns while an access check is still pending", async () => {
    renderSync("/groups/private-club");
    let resolve!: (value: GroupDetail) => void;
    mocks.loadGroupDetail.mockImplementationOnce(
      () =>
        new Promise<GroupDetail>((next) => {
          resolve = next;
        }),
    );
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(mocks.loadGroupDetail).toHaveBeenCalledOnce());
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1_000);
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => {
      resolve({ ...group, member_role: "admin" });
      await Promise.resolve();
    });
    await waitFor(() => expect(mocks.revalidate).toHaveBeenCalledOnce());
    expect(mocks.loadGroupDetail).toHaveBeenCalledOnce();
  });

  it("does not revalidate after the shell unmounts during an access check", async () => {
    const { unmount } = renderSync("/groups/private-club");
    let resolve!: (value: GroupDetail) => void;
    mocks.loadGroupDetail.mockImplementationOnce(
      () =>
        new Promise<GroupDetail>((next) => {
          resolve = next;
        }),
    );
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(mocks.loadGroupDetail).toHaveBeenCalledOnce());
    unmount();
    await act(async () => {
      resolve({ ...group, member_role: "admin" });
      await Promise.resolve();
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("checks the stored push subscription once the shell mounts", async () => {
    renderSync("/");

    await waitFor(() =>
      expect(mocks.resyncWebPushSubscription).toHaveBeenCalledOnce(),
    );
  });

  it.each(["/groups", "/groups/discover", "/groups/create"])(
    "does not revalidate non-detail route %s on focus",
    async (pathname) => {
      const { invalidateQueries } = renderSync(pathname);

      await waitFor(() =>
        expect(mocks.subscribeToNotifications).toHaveBeenCalledOnce(),
      );
      window.dispatchEvent(new Event("focus"));

      await waitFor(() =>
        expect(invalidateQueries).toHaveBeenCalledWith({
          queryKey: notificationKeys.badge(),
        }),
      );
      expect(invalidateQueries).not.toHaveBeenCalledWith({
        queryKey: groupKeys.all,
        refetchType: "none",
      });
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );
});
