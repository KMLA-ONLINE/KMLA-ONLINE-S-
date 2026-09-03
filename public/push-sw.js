/* global self */

const ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUSH_KEYS = [
  "body",
  "category",
  "deliveryId",
  "importance",
  "notificationId",
  "tag",
  "title",
];
const CLICK_KEYS = ["count", "deliveryId", "notificationId"];
const LEGACY_CLICK_KEYS = ["deliveryId", "notificationId"];
const CATEGORY_PATTERN = /^[a-z_]{1,32}$/;
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

// A deployed worker outlives the server that talks to it: `skipWaiting` is off,
// so the previous version keeps handling pushes until the user accepts the
// update prompt. Rejecting a payload for carrying a key this version has never
// heard of would silence every push in that window, so unknown keys are ignored
// instead. Nothing here reads a key outside `expected`.
function hasRequiredKeys(value, expected) {
  return expected.every((key) => key in value);
}

function categoryTitle(category) {
  return Object.hasOwn(CATEGORY_TITLES, category)
    ? CATEGORY_TITLES[category]
    : "새 알림";
}

function isBoundedText(value, maxLength) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Array.from(value).length <= maxLength
  );
}

function isPushPayload(value) {
  if (!isRecord(value) || !hasRequiredKeys(value, PUSH_KEYS)) return false;
  const expectedTag =
    value.importance === "high"
      ? `notification:${value.notificationId}`
      : `notification-category:${value.category}`;
  return (
    ID_PATTERN.test(value.notificationId) &&
    ID_PATTERN.test(value.deliveryId) &&
    IMPORTANCES.includes(value.importance) &&
    // A category this version does not know still groups and tags correctly;
    // only its display title falls back. The shape check keeps the tag
    // comparison below meaningful.
    typeof value.category === "string" &&
    CATEGORY_PATTERN.test(value.category) &&
    isBoundedText(value.title, 160) &&
    isBoundedText(value.body, 240) &&
    value.tag === expectedTag
  );
}

function isClickData(value) {
  return (
    isRecord(value) &&
    (hasExactKeys(value, CLICK_KEYS) ||
      hasExactKeys(value, LEGACY_CLICK_KEYS)) &&
    ID_PATTERN.test(value.notificationId) &&
    ID_PATTERN.test(value.deliveryId) &&
    (value.count === undefined ||
      (Number.isSafeInteger(value.count) && value.count > 0))
  );
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
    await self.registration.getNotifications({
      tag: payload.tag,
    })
  )[0];
  const existingData = existing?.data;
  const repeatedDelivery =
    isClickData(existingData) && existingData.deliveryId === payload.deliveryId;
  const previousCount = isClickData(existingData)
    ? (existingData.count ?? 1)
    : 0;
  const count = repeatedDelivery ? previousCount : previousCount + 1;
  const grouped = count > 1;

  await self.registration.showNotification(
    grouped ? `${categoryTitle(payload.category)} ${count}개` : payload.title,
    {
      body: grouped
        ? `${payload.title} 외 ${count - 1}개의 알림이 있습니다.`
        : payload.body,
      icon: "/pwa-192x192.png",
      tag: payload.tag,
      renotify:
        Boolean(existing) &&
        payload.importance === "normal" &&
        !repeatedDelivery,
      data: {
        notificationId: payload.notificationId,
        deliveryId: payload.deliveryId,
        count,
      },
    },
  );
}

async function openNotification(data) {
  if (!isClickData(data)) return;

  const path =
    (data.count ?? 1) > 1 ? "/noti" : `/noti/open/${data.notificationId}`;
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
  event.waitUntil(showPush(event.data));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openNotification(event.notification.data));
});
