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

/**
 * loader는 `Location`을 실어 Response를 던진다. 잡은 뒤에만 단정하면 리다이렉트가 사라졌을 때
 * 단정식이 한 번도 돌지 않고 통과하므로, 여기서 "던지지 않았다"를 실패로 바꿔 둔다.
 */
async function redirectLocation(notificationId?: string): Promise<string> {
  try {
    await load(notificationId);
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(Response);
    return (thrown as Response).headers.get("Location") ?? "";
  }
  throw new Error("Expected the loader to redirect");
}

describe("notification open route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects an authenticated user only to a safe resolved path", async () => {
    mocks.resolveNotificationDestination.mockResolvedValue("//evil.example");

    await expect(redirectLocation()).resolves.toBe("/noti");
  });

  it("preserves only the fixed resolver path when authentication is missing", async () => {
    mocks.resolveNotificationDestination.mockResolvedValue(null);

    await expect(redirectLocation("id with spaces")).resolves.toBe(
      "/login?next=%2Fnoti%2Fopen%2Fid%2520with%2520spaces",
    );
  });
});
