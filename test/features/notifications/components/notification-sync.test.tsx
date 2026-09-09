import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidate: vi.fn(),
  subscribeToNotifications: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRevalidator: () => ({ revalidate: mocks.revalidate }),
}));

vi.mock("~/features/notifications/data/subscriptions", () => ({
  subscribeToNotifications: mocks.subscribeToNotifications,
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
});
