import type {
  PermissionHelpPlatform,
  PushSupport,
} from "~/features/notifications/model/types";
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

interface ServerPushStatus {
  subscribed: boolean;
  gone: boolean;
}

/** 이 endpoint로 지금 발송되는지, 서버가 죽은 endpoint로 알고 있는지. 읽지 못하면 null이다. */
async function readServerPushStatus(
  endpoint: string,
): Promise<ServerPushStatus | null> {
  const { data, error } = await getSupabase().rpc("get_my_web_push_status", {
    p_endpoint: endpoint,
  });
  if (error) return null;
  return {
    subscribed: data?.[0]?.subscribed === true,
    gone: data?.[0]?.gone === true,
  };
}

/**
 * VAPID 키를 바꾸면 옛 키로 만든 구독은 Push service가 401/403으로 거부한다. 서버는 그 응답을
 * 설정 실수와 구별할 수 없어 구독을 죽은 것으로 표시하지 않으므로, 여기서 비교해 교체한다.
 */
function isSubscribedWithKey(
  subscription: PushSubscription,
  vapidKey: Uint8Array<ArrayBuffer>,
): boolean {
  const key = subscription.options?.applicationServerKey;
  // 옵션을 알려주지 않는 브라우저는 비교할 수 없으니 맞는 것으로 둔다.
  if (!key) return true;
  const bytes = new Uint8Array(key);
  return (
    bytes.length === vapidKey.length &&
    bytes.every((byte, index) => byte === vapidKey[index])
  );
}

/**
 * 쓸 수 없는 브라우저 구독을 버리고 새로 구독한다. Push service가 404/410으로 죽었다고 답한
 * endpoint를 브라우저는 `pushsubscriptionchange` 없이 계속 돌려줄 수 있고, VAPID 키를 바꾸면 옛 키로
 * 만든 구독은 거부된다. 어느 쪽이든 그대로 다시 올리면 다음 발송에서 또 실패한다.
 */
async function replaceSubscription(
  registration: ServiceWorkerRegistration,
  subscription: PushSubscription,
  vapidKey: Uint8Array<ArrayBuffer>,
): Promise<PushSubscription> {
  await subscription.unsubscribe();
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidKey,
  });
}

/** 서버에 올리고 그 구독으로 실제 발송되는지 돌려준다. */
async function registerSubscription(
  subscription: PushSubscription,
): Promise<boolean> {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("Browser returned an incomplete Push subscription");
  }
  const { data, error } = await getSupabase().rpc(
    "register_my_web_push_subscription",
    {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
      p_expiration_time: subscription.expirationTime ?? undefined,
    },
  );
  if (error) throw error;
  return data === true;
}

/**
 * 등록하고, 서버가 이미 죽은 endpoint라고 답하면 새로 구독해 한 번 더 올린다. 같은 키로 다시
 * 올라온 gone endpoint는 서버가 살리지 않으므로, 등록 결과만 보면 상태를 미리 읽지 않아도 된다.
 */
async function registerLiveSubscription(
  registration: ServiceWorkerRegistration,
  subscription: PushSubscription,
  vapidKey: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  if (await registerSubscription(subscription)) return true;
  return registerSubscription(
    await replaceSubscription(registration, subscription, vapidKey),
  );
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
  const subscribed = subscription
    ? (await readServerPushStatus(subscription.endpoint))?.subscribed === true
    : false;
  return {
    state: "available",
    permission: Notification.permission,
    subscribed,
  };
}

export async function enableWebPush(): Promise<PushSupport> {
  // 권한은 첫 await보다 먼저 묻는다. 서비스 워커·구독 확인을 기다린 뒤에 물으면 탭의
  // 사용자 활성화가 식어, 브라우저가 첫 요청을 창 없이 흘려보내고 두 번째 탭에서야 묻는다.
  const permissionRequest =
    readVapidKey() &&
    "Notification" in window &&
    Notification.permission === "default"
      ? Notification.requestPermission()
      : null;

  const initial = await getPushSupport();
  if (initial.state !== "available") return initial;

  const vapidKey = readVapidKey();
  if (!vapidKey) throw new Error("Web Push public key is not configured");

  const requested = permissionRequest
    ? await permissionRequest
    : initial.permission;
  // 설치형 Android 앱은 OS 권한 창을 거치며 반환값이 실제 상태보다 늦을 수 있어 현재 값도 본다.
  const permission =
    requested === "granted" ? requested : Notification.permission;
  if (permission !== "granted") {
    return { state: "available", permission, subscribed: false };
  }

  const registration = await getRegistration();
  if (!registration) throw new Error("Service worker is not ready");
  const existing = await registration.pushManager.getSubscription();
  const subscription = !existing
    ? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey,
      })
    : isSubscribedWithKey(existing, vapidKey)
      ? existing
      : await replaceSubscription(registration, existing, vapidKey);
  // 새로 구독한 것까지 서버가 거부하면 스위치만 꺼진 채 남지 않도록 실패로 알린다.
  if (!(await registerLiveSubscription(registration, subscription, vapidKey))) {
    throw new Error("Push subscription was refused by the server");
  }
  return { state: "available", permission, subscribed: true };
}

/**
 * 브라우저의 구독을 서버가 모르거나 죽은 endpoint로 알고 있으면 다시 등록한다(죽었으면 새로 구독해서). 서비스 워커의 `pushsubscriptionchange`는 로그인 세션이 없어 새 endpoint를 못 올리므로 그 나머지 절반이다.
 * 없는 구독은 만들지 않는다 — `disableWebPush()`가 권한은 남기고 구독만 해지하기 때문이다.
 * 배경 정비라 실패는 삼키고 다음 실행에서 다시 시도한다.
 */
export async function resyncWebPushSubscription(): Promise<void> {
  try {
    if (
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      Notification.permission !== "granted"
    ) {
      return;
    }
    const vapidKey = readVapidKey();
    if (!vapidKey) return;

    const registration = await getRegistration();
    const existing = await registration?.pushManager.getSubscription();
    if (!registration || !existing) return;

    if (!isSubscribedWithKey(existing, vapidKey)) {
      await registerLiveSubscription(
        registration,
        await replaceSubscription(registration, existing, vapidKey),
        vapidKey,
      );
      return;
    }

    // 흔한 경우는 "이미 맞다"이므로 읽기 한 번으로 끝내고, 어긋난 경우에만 쓴다.
    const status = await readServerPushStatus(existing.endpoint);
    if (!status || status.subscribed) return;

    await registerLiveSubscription(
      registration,
      status.gone
        ? await replaceSubscription(registration, existing, vapidKey)
        : existing,
      vapidKey,
    );
  } catch {
    // 다음 실행에서 다시 시도한다.
  }
}

/**
 * 차단된 알림 권한을 어디서 풀지 고른다. 웹은 그 설정 화면을 직접 열 수 없어 경로를 글로 안내해야 한다.
 * iOS 브라우저 탭은 Push 자체를 못 쓰므로(`ios-browser`) 여기 오는 iOS는 홈 화면 앱뿐이다.
 */
export function getPermissionHelpPlatform(): PermissionHelpPlatform {
  if (isIOS()) return "ios-app";
  if (/Android/i.test(navigator.userAgent)) {
    return isStandalone() ? "android-app" : "android-browser";
  }
  return isStandalone() ? "desktop-app" : "desktop-browser";
}

/**
 * 알림 권한이 바뀌었을 수 있는 순간마다 `onChange`를 부른다. 브라우저·OS 설정에서 차단을 풀고 돌아온 경우가 대상이다.
 * `permissions` 변경 이벤트가 정확하지만 모든 브라우저가 알림 권한에 주지는 않아 화면 복귀도 함께 본다.
 */
export function watchNotificationPermission(onChange: () => void): () => void {
  let status: PermissionStatus | null = null;
  let disposed = false;
  const onVisible = () => {
    if (document.visibilityState === "visible") onChange();
  };

  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onVisible);
  void navigator.permissions
    ?.query({ name: "notifications" })
    .then((result) => {
      if (disposed) return;
      status = result;
      status.addEventListener("change", onChange);
    })
    .catch(() => {
      // 질의를 못 하는 브라우저는 화면 복귀만으로 다시 확인한다.
    });

  return () => {
    disposed = true;
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onVisible);
    status?.removeEventListener("change", onChange);
  };
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
    // rpc는 실패해도 throw하지 않고 `error`로 돌려준다. 호출부가 실패를 알 수 있게 던진다.
    const { error } = await getSupabase().rpc(
      "unregister_my_web_push_subscription",
      { p_endpoint: subscription.endpoint },
    );
    if (error) throw error;
  } finally {
    await subscription.unsubscribe();
  }
}
