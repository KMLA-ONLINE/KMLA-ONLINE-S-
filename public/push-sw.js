/* global self */

const ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUSH_KEYS = ["body", "deliveryId", "notificationId", "tag", "title"];
const CLICK_KEYS = ["deliveryId", "notificationId"];

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
  return (
    isRecord(value) &&
    hasExactKeys(value, PUSH_KEYS) &&
    ID_PATTERN.test(value.notificationId) &&
    ID_PATTERN.test(value.deliveryId) &&
    isBoundedText(value.title, 120) &&
    isBoundedText(value.body, 240) &&
    value.tag === `notification:${value.notificationId}`
  );
}

function isClickData(value) {
  return (
    isRecord(value) &&
    hasExactKeys(value, CLICK_KEYS) &&
    ID_PATTERN.test(value.notificationId) &&
    ID_PATTERN.test(value.deliveryId)
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

  await self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "/pwa-192x192.png",
    tag: payload.tag,
    data: {
      notificationId: payload.notificationId,
      deliveryId: payload.deliveryId,
    },
  });
}

async function openNotification(data) {
  if (!isClickData(data)) return;

  const path = `/noti/open/${data.notificationId}`;
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
