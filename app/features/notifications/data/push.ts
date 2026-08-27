import type { PushSupport } from "~/features/notifications/model/types";
import { getSupabase } from "~/shared/supabase/client";

function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    nav.standalone === true
  );
}

function decodeVapidKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

/**
 * A misconfigured deploy has to read as "unconfigured" rather than throw out of
 * `atob` or `subscribe()`. An applicationServerKey is an uncompressed P-256
 * point, so anything that is not 65 bytes starting with 0x04 cannot work.
 */
function readVapidKey(): Uint8Array<ArrayBuffer> | null {
  const value = import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  if (!value) return null;

  try {
    const key = decodeVapidKey(value);
    return key.length === 65 && key[0] === 0x04 ? key : null;
  } catch {
    return null;
  }
}

// `serviceWorker.ready` never settles when registration fails outright, which a
// browser with workers blocked will do. Without a bound the settings
// clientLoader would stay pending forever with nothing to show the user.
const REGISTRATION_READY_TIMEOUT_MS = 5000;

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  // `pushManager.subscribe()` rejects with AbortError unless the registration
  // has an *active* worker, and `getRegistration` resolves as soon as one is
  // merely installing. Only `ready` guarantees an activated worker.
  if (registration?.active) return registration;
  if (!import.meta.env.PROD) return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), REGISTRATION_READY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function getPushSupport(): Promise<PushSupport> {
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return { state: "unsupported" };
  }
  if (isIOS() && !isStandalone()) return { state: "ios-browser" };
  if (!readVapidKey()) return { state: "unconfigured" };

  const registration = await getRegistration();
  if (!registration) return { state: "unsupported" };
  const subscription = await registration.pushManager.getSubscription();
  let subscribed = false;
  if (subscription) {
    const { data, error } = await getSupabase().rpc("get_my_web_push_status", {
      p_endpoint: subscription.endpoint,
    });
    if (!error) subscribed = data?.[0]?.subscribed === true;
  }
  return {
    state: "available",
    permission: Notification.permission,
    subscribed,
  };
}

export async function enableWebPush(): Promise<PushSupport> {
  const initial = await getPushSupport();
  if (initial.state !== "available") return initial;

  const vapidKey = readVapidKey();
  if (!vapidKey) throw new Error("Web Push public key is not configured");

  const permission =
    initial.permission === "default"
      ? await Notification.requestPermission()
      : initial.permission;
  if (permission !== "granted") {
    return { state: "available", permission, subscribed: false };
  }

  const registration = await getRegistration();
  if (!registration) throw new Error("Service worker is not ready");
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKey,
    }));
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("Browser returned an incomplete Push subscription");
  }

  const { error } = await getSupabase().rpc(
    "register_my_web_push_subscription",
    {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
      p_expiration_time: subscription.expirationTime ?? undefined,
    },
  );
  if (error) throw error;
  return { state: "available", permission, subscribed: true };
}

export async function disableWebPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await getRegistration();
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const { error } = await getSupabase().rpc(
    "unregister_my_web_push_subscription",
    { p_endpoint: subscription.endpoint },
  );
  if (error) throw error;
  await subscription.unsubscribe();
}

export async function disconnectWebPushForLogout(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  try {
    await getSupabase().rpc("unregister_my_web_push_subscription", {
      p_endpoint: subscription.endpoint,
    });
  } finally {
    await subscription.unsubscribe();
  }
}
