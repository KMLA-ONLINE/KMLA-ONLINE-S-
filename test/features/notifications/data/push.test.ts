import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  enableWebPush,
  getPushSupport,
} from "~/features/notifications/data/push";

describe("Web Push configuration", () => {
  // 0x04 followed by 64 bytes: the shape `subscribe()` requires of an
  // applicationServerKey.
  const VALID_VAPID_KEY =
    "BAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
  const getRegistration = vi.fn();
  const requestPermission = vi.fn();

  beforeEach(() => {
    vi.stubEnv("VITE_WEB_PUSH_VAPID_PUBLIC_KEY", "");
    const notification = {
      permission: "default",
      requestPermission,
    };
    const pushManager = class PushManager {};
    vi.stubGlobal("window", {
      Notification: notification,
      PushManager: pushManager,
    });
    vi.stubGlobal("Notification", notification);
    vi.stubGlobal("PushManager", pushManager);
    vi.stubGlobal("navigator", {
      maxTouchPoints: 0,
      platform: "Win32",
      serviceWorker: { getRegistration },
      userAgent: "test",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports missing VAPID configuration without checking a worker", async () => {
    await expect(getPushSupport()).resolves.toEqual({ state: "unconfigured" });
    expect(getRegistration).not.toHaveBeenCalled();
  });

  it("does not request permission when VAPID is unconfigured", async () => {
    await expect(enableWebPush()).resolves.toEqual({ state: "unconfigured" });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it.each([
    // The placeholder from supabase/functions/.env.example: pads to three "="
    // and used to throw InvalidCharacterError straight out of atob.
    ["a placeholder that is not base64", "replace-with-vapid-public-key"],
    ["valid base64 that is not a P-256 point", "dGVzdA"],
  ])("treats %s as unconfigured", async (_label, value) => {
    vi.stubEnv("VITE_WEB_PUSH_VAPID_PUBLIC_KEY", value);

    await expect(getPushSupport()).resolves.toEqual({ state: "unconfigured" });
    expect(getRegistration).not.toHaveBeenCalled();
  });

  it("stops waiting for a worker that never becomes ready", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_WEB_PUSH_VAPID_PUBLIC_KEY", VALID_VAPID_KEY);
    getRegistration.mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      maxTouchPoints: 0,
      platform: "Win32",
      // A browser with service workers blocked never settles `ready`.
      serviceWorker: { getRegistration, ready: new Promise(() => undefined) },
      userAgent: "test",
    });

    const support = getPushSupport();
    await vi.advanceTimersByTimeAsync(5000);

    await expect(support).resolves.toEqual({ state: "unsupported" });
  });
});
