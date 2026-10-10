import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSupabase, rpc } = vi.hoisted(() => ({
  getSupabase: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("~/shared/supabase/client", () => ({ getSupabase }));

import {
  enableWebPush,
  getPushSupport,
  resyncWebPushSubscription,
} from "~/features/notifications/data/push";

describe("Web Push configuration", () => {
  // 0x04 followed by 64 bytes: the shape `subscribe()` requires of an
  // applicationServerKey.
  const VALID_VAPID_KEY =
    "BAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
  const getRegistration = vi.fn();
  const requestPermission = vi.fn();

  beforeEach(() => {
    getSupabase.mockReset();
    rpc.mockReset();
    getRegistration.mockReset();
    requestPermission.mockReset();
    getSupabase.mockReturnValue({ rpc });
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

  it("waits for an active worker instead of one still installing", async () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_WEB_PUSH_VAPID_PUBLIC_KEY", VALID_VAPID_KEY);
    // `subscribe()` throws AbortError on this one, so it must not be used.
    const installing = {
      active: null,
      pushManager: { getSubscription: vi.fn() },
    };
    const activated = {
      active: {},
      pushManager: { getSubscription: vi.fn().mockResolvedValue(null) },
    };
    getRegistration.mockResolvedValue(installing);
    vi.stubGlobal("navigator", {
      maxTouchPoints: 0,
      platform: "Win32",
      serviceWorker: { getRegistration, ready: Promise.resolve(activated) },
      userAgent: "test",
    });

    await expect(getPushSupport()).resolves.toEqual({
      state: "available",
      permission: "default",
      subscribed: false,
    });
    expect(activated.pushManager.getSubscription).toHaveBeenCalled();
    expect(installing.pushManager.getSubscription).not.toHaveBeenCalled();
  });

  it("reports a browser subscription only when it is registered for the account", async () => {
    vi.stubEnv("VITE_WEB_PUSH_VAPID_PUBLIC_KEY", VALID_VAPID_KEY);
    const subscription = { endpoint: "https://push.example/subscription" };
    getRegistration.mockResolvedValue({
      active: {},
      pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) },
    });
    rpc.mockResolvedValue({ data: [{ subscribed: true }], error: null });

    await expect(getPushSupport()).resolves.toEqual({
      state: "available",
      permission: "default",
      subscribed: true,
    });
    expect(rpc).toHaveBeenCalledWith("get_my_web_push_status", {
      p_endpoint: subscription.endpoint,
    });
  });

  it("reports a browser subscription missing from the account as disabled", async () => {
    vi.stubEnv("VITE_WEB_PUSH_VAPID_PUBLIC_KEY", VALID_VAPID_KEY);
    getRegistration.mockResolvedValue({
      active: {},
      pushManager: {
        getSubscription: vi
          .fn()
          .mockResolvedValue({ endpoint: "https://push.example/orphaned" }),
      },
    });
    rpc.mockResolvedValue({ data: [{ subscribed: false }], error: null });

    await expect(getPushSupport()).resolves.toEqual({
      state: "available",
      permission: "default",
      subscribed: false,
    });
  });

  it("keeps settings available when account subscription status cannot be loaded", async () => {
    vi.stubEnv("VITE_WEB_PUSH_VAPID_PUBLIC_KEY", VALID_VAPID_KEY);
    getRegistration.mockResolvedValue({
      active: {},
      pushManager: {
        getSubscription: vi
          .fn()
          .mockResolvedValue({ endpoint: "https://push.example/unavailable" }),
      },
    });
    rpc.mockResolvedValue({ data: null, error: new Error("network error") });

    await expect(getPushSupport()).resolves.toEqual({
      state: "available",
      permission: "default",
      subscribed: false,
    });
  });

  it("re-registers an existing browser subscription missing from the account", async () => {
    vi.stubEnv("VITE_WEB_PUSH_VAPID_PUBLIC_KEY", VALID_VAPID_KEY);
    const notification = {
      permission: "granted",
      requestPermission,
    };
    vi.stubGlobal("window", {
      Notification: notification,
      PushManager,
    });
    vi.stubGlobal("Notification", notification);
    const subscription = {
      endpoint: "https://push.example/orphaned",
      expirationTime: null,
      toJSON: () => ({
        endpoint: "https://push.example/orphaned",
        keys: { auth: "auth", p256dh: "p256dh" },
      }),
    };
    getRegistration.mockResolvedValue({
      active: {},
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(subscription),
      },
    });
    rpc
      .mockResolvedValueOnce({
        data: [{ subscribed: false, gone: false }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ subscribed: false, gone: false }],
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });

    await expect(enableWebPush()).resolves.toEqual({
      state: "available",
      permission: "granted",
      subscribed: true,
    });
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "register_my_web_push_subscription",
      {
        p_auth: "auth",
        p_endpoint: subscription.endpoint,
        p_expiration_time: undefined,
        p_p256dh: "p256dh",
      },
    );
  });

  describe("an endpoint the push service already ended", () => {
    function grantPermission() {
      vi.stubEnv("VITE_WEB_PUSH_VAPID_PUBLIC_KEY", VALID_VAPID_KEY);
      const notification = { permission: "granted", requestPermission };
      vi.stubGlobal("window", { Notification: notification, PushManager });
      vi.stubGlobal("Notification", notification);
    }

    function pushSubscription(endpoint: string) {
      return {
        endpoint,
        expirationTime: null,
        unsubscribe: vi.fn().mockResolvedValue(true),
        toJSON: () => ({ endpoint, keys: { auth: "auth", p256dh: "p256dh" } }),
      };
    }

    function goneSetup() {
      grantPermission();
      const stale = pushSubscription("https://push.example/stale");
      const fresh = pushSubscription("https://push.example/fresh");
      const subscribe = vi.fn().mockResolvedValue(fresh);
      getRegistration.mockResolvedValue({
        active: {},
        pushManager: {
          getSubscription: vi.fn().mockResolvedValue(stale),
          subscribe,
        },
      });
      rpc.mockImplementation((name: string) =>
        Promise.resolve(
          name === "get_my_web_push_status"
            ? { data: [{ subscribed: false, gone: true }], error: null }
            : { data: null, error: null },
        ),
      );
      return { stale, fresh, subscribe };
    }

    it("is replaced with a new subscription when Push is turned on", async () => {
      const { stale, fresh, subscribe } = goneSetup();

      await expect(enableWebPush()).resolves.toMatchObject({
        subscribed: true,
      });
      expect(stale.unsubscribe).toHaveBeenCalledOnce();
      expect(subscribe).toHaveBeenCalledOnce();
      expect(rpc).toHaveBeenCalledWith(
        "register_my_web_push_subscription",
        expect.objectContaining({ p_endpoint: fresh.endpoint }),
      );
    });

    it("is replaced in the background instead of being re-registered", async () => {
      const { stale, fresh, subscribe } = goneSetup();

      await resyncWebPushSubscription();

      expect(stale.unsubscribe).toHaveBeenCalledOnce();
      expect(subscribe).toHaveBeenCalledOnce();
      expect(rpc).toHaveBeenCalledWith(
        "register_my_web_push_subscription",
        expect.objectContaining({ p_endpoint: fresh.endpoint }),
      );
      expect(rpc).not.toHaveBeenCalledWith(
        "register_my_web_push_subscription",
        expect.objectContaining({ p_endpoint: stale.endpoint }),
      );
    });
  });

  it("asks for permission before waiting on the worker", () => {
    vi.stubEnv("VITE_WEB_PUSH_VAPID_PUBLIC_KEY", VALID_VAPID_KEY);
    getRegistration.mockReturnValue(new Promise(() => undefined));
    requestPermission.mockResolvedValue("granted");

    void enableWebPush();

    // 첫 await 전에 불려야 탭의 사용자 활성화 안에서 권한 창이 뜬다.
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it("trusts the live permission when the request resolves stale", async () => {
    vi.stubEnv("VITE_WEB_PUSH_VAPID_PUBLIC_KEY", VALID_VAPID_KEY);
    const notification = {
      permission: "default",
      requestPermission: vi.fn(() => {
        notification.permission = "granted";
        return Promise.resolve("default");
      }),
    };
    vi.stubGlobal("window", { Notification: notification, PushManager });
    vi.stubGlobal("Notification", notification);
    const subscription = {
      endpoint: "https://push.example/new",
      expirationTime: null,
      toJSON: () => ({
        endpoint: "https://push.example/new",
        keys: { auth: "auth", p256dh: "p256dh" },
      }),
    };
    getRegistration.mockResolvedValue({
      active: {},
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn().mockResolvedValue(subscription),
      },
    });
    rpc.mockResolvedValue({ data: null, error: null });

    await expect(enableWebPush()).resolves.toEqual({
      state: "available",
      permission: "granted",
      subscribed: true,
    });
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
