import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveNotificationDestination: vi.fn(),
}));

vi.mock("~/features/notifications", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveNotificationDestination: mocks.resolveNotificationDestination,
}));

import { clientLoader } from "~/routes/notification-open";

function load(notificationId = "notification-id") {
  const url = `https://example.com/noti/open/${notificationId}`;
  return clientLoader({
    params: { notificationId },
    context: new RouterContextProvider(),
    request: new Request(url),
    url: new URL(url),
    pattern: "/noti/open/:notificationId",
    serverLoader: () => Promise.resolve(undefined),
  });
}

describe("notification open route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects an authenticated user only to a safe resolved path", async () => {
    mocks.resolveNotificationDestination.mockResolvedValue("//evil.example");

    await expect(load()).rejects.toMatchObject({
      status: 302,
      headers: expect.objectContaining({}),
    });
    await load().catch((response: Response) => {
      expect(response.headers.get("Location")).toBe("/noti");
    });
  });

  it("preserves only the fixed resolver path when authentication is missing", async () => {
    mocks.resolveNotificationDestination.mockResolvedValue(null);

    await load("id with spaces").catch((response: Response) => {
      expect(response.headers.get("Location")).toBe(
        "/login?next=%2Fnoti%2Fopen%2Fid%2520with%2520spaces",
      );
    });
  });
});
