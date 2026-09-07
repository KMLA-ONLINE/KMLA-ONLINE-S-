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
      tag: payload.tag,
      renotify: Boolean(existing) && payload.importance === "normal",
      data: {
        notificationId: payload.notificationId,
        deliveryIds,
        count,
      },
    },
  );
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
  event.waitUntil(openNotification(event.notification.data));
});
