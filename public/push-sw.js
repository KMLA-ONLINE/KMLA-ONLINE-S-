/* global self */

const ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUSH_KEYS = [
  "body",
  "category",
  "deliveryId",
  "groupingKey",
  "importance",
  "notificationId",
  "tag",
  "title",
];
const CLICK_KEYS = ["count", "deliveryIds", "notificationId"];
const CATEGORIES = [
  "content",
  "timeline",
  "group",
  "account",
  "school",
  "moderation",
];
const IMPORTANCES = ["low", "normal", "high"];
const CATEGORY_TITLES = {
  content: "콘텐츠 알림",
  timeline: "타임라인 알림",
  group: "그룹 알림",
  account: "계정·권한 알림",
  school: "학교 기능 알림",
  moderation: "운영 조치 알림",
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  );
}

function isBoundedText(value, maxLength) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function isPushPayload(value) {
  if (!isRecord(value) || !hasExactKeys(value, PUSH_KEYS)) return false;
  const expectedTag =
    value.importance === "high"
      ? `notification:${value.notificationId}`
      : `notification-category:${value.category}:${value.groupingKey}`;
  return (
    ID_PATTERN.test(value.notificationId) &&
    ID_PATTERN.test(value.deliveryId) &&
    ID_PATTERN.test(value.groupingKey) &&
    IMPORTANCES.includes(value.importance) &&
    CATEGORIES.includes(value.category) &&
    isBoundedText(value.title, 120) &&
    isBoundedText(value.body, 240) &&
    value.tag === expectedTag
  );
}

function isClickData(value) {
  if (!isRecord(value) || !hasExactKeys(value, CLICK_KEYS)) return false;
  const deliveryIds = value.deliveryIds;
  return (
    ID_PATTERN.test(value.notificationId) &&
    Array.isArray(deliveryIds) &&
    deliveryIds.length > 0 &&
    deliveryIds.every((id) => ID_PATTERN.test(id)) &&
    new Set(deliveryIds).size === deliveryIds.length &&
    Number.isSafeInteger(value.count) &&
    value.count === deliveryIds.length
  );
}

/**
 * 홈 화면 아이콘 위의 숫자(Badging API).
 *
 * 앱이 떠 있을 때의 정답은 서버가 세는 안 읽은 수이고 그쪽은 앱이
 * (`app/shared/lib/app-badge.ts`) 쓴다. 여기서 세는 건 앱이 떠 있지 않은 동안 도착해 아직
 * 화면에 남아 있는 알림 카드의 합이다 — 그 시간대에는 이쪽이 유일하게 아는 값이고, 앱이
 * 다시 열리면 게이트 로더가 곧바로 서버 값으로 덮는다.
 *
 * 지원하지 않는 환경(데스크톱 Firefox 등)이 정상 경로에 있으므로 실패는 삼킨다. 뱃지는
 * 부가 정보라 이것 때문에 push 표시가 밀리면 안 된다.
 */
async function syncAppBadge() {
  const badging = self.navigator;
  if (!badging || typeof badging.setAppBadge !== "function") return;

  try {
    const shown = await self.registration.getNotifications();
    const total = shown.reduce(
      (sum, notification) =>
        sum + (isClickData(notification.data) ? notification.data.count : 0),
      0,
    );
    if (total > 0) await badging.setAppBadge(total);
    else await badging.clearAppBadge();
  } catch {
    // 지원하지 않거나 권한이 없는 환경.
  }
}

async function showPush(data) {
  if (!data) return;

  let payload;
  try {
    payload = data.json();
  } catch {
    return;
  }

  if (!isPushPayload(payload)) return;

  const existing = (
    await self.registration.getNotifications({ tag: payload.tag })
  )[0];
  const existingData = existing?.data;
  const previousDeliveryIds = isClickData(existingData)
    ? existingData.deliveryIds
    : [];
  if (previousDeliveryIds.includes(payload.deliveryId)) return;

  const deliveryIds = [...previousDeliveryIds, payload.deliveryId];
  const count = deliveryIds.length;
  const grouped = count > 1;

  await self.registration.showNotification(
    grouped ? `${CATEGORY_TITLES[payload.category]} ${count}개` : payload.title,
    {
      body: grouped
        ? `${payload.title} 외 ${count - 1}개의 알림이 있습니다.`
        : payload.body,
      icon: "/pwa-192x192.png",
      // Android 상태바는 컬러 아이콘이 아니라 알파 채널만 읽어 단색으로 칠한 실루엣을
      // 쓴다. 주지 않으면 브라우저 기본 도형이 대신 뜬다 — 잠금 화면에서 이 앱의
      // 알림이라는 걸 알아볼 수 있는 유일한 표시라 icon보다 이쪽이 더 중요하다.
      badge: "/badge-96x96.png",
      // 본문이 한국어다. 화면 낭독기가 알림을 읽을 때 언어를 못 고르면 자모가 영어
      // 음성으로 나온다.
      lang: "ko",
      tag: payload.tag,
      renotify: Boolean(existing) && payload.importance === "normal",
      data: {
        notificationId: payload.notificationId,
        deliveryIds,
        count,
      },
    },
  );

  await syncAppBadge();
}

let pushQueue = Promise.resolve();

function enqueuePush(data) {
  const task = pushQueue.then(() => showPush(data));
  pushQueue = task.catch(() => undefined);
  return task;
}

async function openNotification(data) {
  if (!isClickData(data)) return;

  const path = data.count > 1 ? "/noti" : `/noti/open/${data.notificationId}`;
  const destination = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const appWindow = windows.find((client) => {
    try {
      return new URL(client.url).origin === self.location.origin;
    } catch {
      return false;
    }
  });

  if (appWindow) {
    await appWindow.focus();
    await appWindow.navigate(destination);
    return;
  }

  await self.clients.openWindow(path);
}

self.addEventListener("push", (event) => {
  event.waitUntil(enqueuePush(event.data));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    Promise.all([openNotification(event.notification.data), syncAppBadge()]),
  );
});

// 카드를 눌러서 여는 것과 쓸어서 지우는 것 모두 "이제 화면에 없다"는 뜻이다. 지운 쪽만
// 빼놓으면 앱을 열기 전까지 뱃지에 이미 치운 알림 수가 남는다.
self.addEventListener("notificationclose", (event) => {
  event.waitUntil(syncAppBadge());
});

/**
 * Push service가 구독을 갈아치우면 기존 endpoint는 죽는다. 다시 구독하지 않으면 사용자는
 * 알림 설정에 "켜짐"이 그대로 떠 있는 채로 알림만 조용히 끊긴다.
 *
 * 여기서는 브라우저 쪽 구독만 되살린다. 새 endpoint를 서버에 올리려면 로그인 세션이
 * 필요한데 서비스 워커에는 없다 — 그건 앱이 다음에 뜰 때
 * `resyncWebPushSubscription()`이 맡는다. 죽은 옛 endpoint는 전달 worker가 410을 받아
 * 정리한다.
 *
 * `oldSubscription.options`를 그대로 넘기는 이유는 VAPID 공개키 때문이다. 이 파일은
 * Vite가 빌드하지 않는 정적 파일이라 `import.meta.env`를 읽을 수 없고, 브라우저가 옛
 * 구독의 생성 옵션을 들고 있으므로 키를 다시 구할 필요가 없다.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  const options = event.oldSubscription?.options;
  if (!options) return;
  event.waitUntil(
    self.registration.pushManager.subscribe(options).catch(() => undefined),
  );
});
