import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

vi.mock("~/features/notifications", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listNotifications: mocks.listNotifications,
  markAllNotificationsRead: mocks.markAllNotificationsRead,
}));

import { clientAction, clientLoader } from "~/routes/app/notifications";

function loaderRequest(search = "") {
  const url = `https://example.com/noti${search}`;
  return clientLoader({
    params: {},
    context: new RouterContextProvider(),
    request: new Request(url),
    url: new URL(url),
    pattern: "/noti",
    serverLoader: () => Promise.resolve(undefined),
  });
}

function actionRequest(fields: Record<string, string>) {
  return clientAction({
    request: new Request("https://example.com/noti", {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
  } as never);
}

describe("notification inbox route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listNotifications.mockResolvedValue([]);
  });

  it("loads the first page without a cursor", async () => {
    await expect(loaderRequest()).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(mocks.listNotifications).toHaveBeenCalledWith(null);
  });

  it("passes both opaque cursor fields when loading more", async () => {
    await loaderRequest(
      "?beforeId=notification-id&beforeLastActivityAt=2026-08-26T10%3A00%3A00.000Z",
    );

    expect(mocks.listNotifications).toHaveBeenCalledWith({
      beforeId: "notification-id",
      beforeLastActivityAt: "2026-08-26T10:00:00.000Z",
    });
  });

  it("dispatches the mark-all intent", async () => {
    mocks.markAllNotificationsRead.mockResolvedValue(3);

    await expect(actionRequest({ intent: "mark-all" })).resolves.toEqual({
      marked: 3,
    });

    expect(mocks.markAllNotificationsRead).toHaveBeenCalledOnce();
  });
});
