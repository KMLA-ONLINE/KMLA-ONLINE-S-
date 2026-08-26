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

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (registration || !import.meta.env.PROD) return registration ?? null;
  return navigator.serviceWorker.ready;
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
  if (!import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY) {
    return { state: "unconfigured" };
  }

  const registration = await getRegistration();
  if (!registration) return { state: "unsupported" };
  const subscription = await registration.pushManager.getSubscription();
  return {
    state: "available",
    permission: Notification.permission,
    subscribed: subscription !== null,
  };
}

export async function enableWebPush(): Promise<PushSupport> {
  const initial = await getPushSupport();
  if (initial.state !== "available") return initial;

  const vapidKey = import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY;
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
      applicationServerKey: decodeVapidKey(vapidKey),
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
