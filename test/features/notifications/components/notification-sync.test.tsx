import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationSync } from "~/features/notifications/components/notification-sync";
import { renderRoute } from "../../../router";

const mocks = vi.hoisted(() => ({
  refreshWebPushForeground: vi.fn(() => Promise.resolve()),
  subscribeToNotifications: vi.fn(() => vi.fn()),
}));

vi.mock("~/features/notifications/data/push", () => ({
  refreshWebPushForeground: mocks.refreshWebPushForeground,
}));
vi.mock("~/features/notifications/data/subscriptions", () => ({
  subscribeToNotifications: mocks.subscribeToNotifications,
}));

describe("NotificationSync", () => {
  let focused = true;
  let visibility: DocumentVisibilityState = "visible";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    focused = true;
    visibility = "visible";
    vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes only while the app window is visible and focused", async () => {
    renderRoute(() => <NotificationSync profileId={42} />);

    expect(mocks.refreshWebPushForeground).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTime(30_000));
    expect(mocks.refreshWebPushForeground).toHaveBeenCalledTimes(2);

    focused = false;
    await act(() => window.dispatchEvent(new Event("blur")));
    await act(() => vi.advanceTimersByTime(60_000));
    expect(mocks.refreshWebPushForeground).toHaveBeenCalledTimes(2);

    focused = true;
    await act(() => window.dispatchEvent(new Event("focus")));
    expect(mocks.refreshWebPushForeground).toHaveBeenCalledTimes(3);

    visibility = "hidden";
    await act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(() => vi.advanceTimersByTime(60_000));
    expect(mocks.refreshWebPushForeground).toHaveBeenCalledTimes(3);
  });
});
