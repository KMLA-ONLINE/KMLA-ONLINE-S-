import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadNotificationPage: vi.fn(),
}));

vi.mock("~/features/notifications", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadNotificationPage: mocks.loadNotificationPage,
}));

import { clientLoader, shouldRevalidate } from "~/routes/app/notification-page";

function loaderRequest(search = "") {
  const url = `https://example.com/noti/page${search}`;
  return clientLoader({
    params: {},
    context: new RouterContextProvider(),
    request: new Request(url),
    url: new URL(url),
    pattern: "/noti/page",
    serverLoader: () => Promise.resolve(undefined),
  });
}

describe("notification pagination route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadNotificationPage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
  });

  it("loads the requested cursor page", async () => {
    await loaderRequest(
      "?beforeId=notification-id&beforeLastActivityAt=2026-08-26T10%3A00%3A00.000Z",
    );

    expect(mocks.loadNotificationPage).toHaveBeenCalledWith({
      beforeId: "notification-id",
      beforeLastActivityAt: "2026-08-26T10:00:00.000Z",
    });
  });

  it("does not reload a retained cursor fetcher during global revalidation", () => {
    expect(shouldRevalidate()).toBe(false);
  });
});
