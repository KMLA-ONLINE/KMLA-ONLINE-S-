import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidate: vi.fn(),
  subscribeToNotifications: vi.fn(),
  getRecentUnreadNotificationCount: vi.fn(() => Promise.resolve(0)),
  resyncWebPushSubscription: vi.fn(() => Promise.resolve()),
  setAppBadgeCount: vi.fn(),
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

vi.mock("~/shared/lib/app-badge", () => ({
  setAppBadgeCount: mocks.setAppBadgeCount,
}));

import { groupKeys } from "~/features/groups/data/cache";
import { NotificationSync } from "~/features/notifications/components/notification-sync";
import { notificationKeys } from "~/features/notifications/data/cache";

afterEach(() => {
  vi.clearAllMocks();
});

function renderSync(pathname: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  mocks.subscribeToNotifications.mockReturnValue(() => undefined);

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[pathname]}>
        <NotificationSync profileId={7} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { invalidateQueries };
}

describe("NotificationSync", () => {
  it("revalidates a focused group route after making its cached access data stale", async () => {
    const { invalidateQueries } = renderSync("/groups/private-club");

    await waitFor(() =>
      expect(mocks.subscribeToNotifications).toHaveBeenCalledWith(
        7,
        expect.any(Function),
      ),
    );
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(mocks.revalidate).toHaveBeenCalledOnce());
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: notificationKeys.badge(),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: groupKeys.all,
      refetchType: "none",
    });
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
    expect(mocks.revalidate).toHaveBeenCalledOnce();
  });

  it("coalesces focus and visibilitychange from one return into a single sync", async () => {
    renderSync("/groups/private-club");

    await waitFor(() =>
      expect(mocks.subscribeToNotifications).toHaveBeenCalledOnce(),
    );
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => expect(mocks.revalidate).toHaveBeenCalledOnce());
  });

  it("mirrors the shell badge onto the app icon", async () => {
    mocks.getRecentUnreadNotificationCount.mockResolvedValueOnce(3);
    renderSync("/");

    await waitFor(() => expect(mocks.setAppBadgeCount).toHaveBeenCalledWith(3));
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
