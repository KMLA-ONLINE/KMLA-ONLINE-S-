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
const MESSAGE_PUSH_KEYS = [
  "body",
  "conversationId",
  "deliveryId",
  "messageId",
  "title",
  "type",
];
const MESSAGE_CLICK_KEYS = ["conversationId", "deliveryId"];
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
    // 서버 제목 한도(`notifications_title_length`)와 같다. 더 좁으면 긴 게시물 제목을 담은
    // 운영 조치 알림이 검증에서 떨어진다.
    isBoundedText(value.title, 160) &&
    isBoundedText(value.body, 240) &&
    value.tag === expectedTag
  );
}

/**
 * 메시지 Push(알림 기술 설계 §11.4). 대화 ID만 믿고, 누르면 그 ID로 대화방 주소를 직접 만든다.
 * 대화방 loader가 접근 권한을 다시 확인한다.
 */
// 서버는 메시지 본문을 code point 기준으로 자른다(`left(..., 240)`). `String.length`는 UTF-16 단위라
// 이모지가 많은 본문이 한도를 넘은 것으로 보인다.
function isBoundedCodePoints(value, maxLength) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    [...value].length <= maxLength
  );
}

function isMessagePushPayload(value) {
  return (
    isRecord(value) &&
    hasExactKeys(value, MESSAGE_PUSH_KEYS) &&
    value.type === "message" &&
    ID_PATTERN.test(value.conversationId) &&
    ID_PATTERN.test(value.messageId) &&
    ID_PATTERN.test(value.deliveryId) &&
    isBoundedCodePoints(value.title, 160) &&
    isBoundedCodePoints(value.body, 240)
  );
}

function isMessageClickData(value) {
  return (
    isRecord(value) &&
    hasExactKeys(value, MESSAGE_CLICK_KEYS) &&
    ID_PATTERN.test(value.conversationId) &&
    ID_PATTERN.test(value.deliveryId)
  );
}

/**
 * 같은 대화의 새 메시지는 대화별 카드 하나를 교체하고 다시 알린다. 대화방이 화면에 열려 있어도
 * 카드를 생략하지 않는다. `userVisibleOnly` 구독에서 생략하면 iOS가 구독을 끊을 수 있어 억제는 서버의
 * 발송 직전 확인만 맡는다. 홈 화면 숫자에는 대화마다 카드 하나로 센다(`syncAppBadge`).
 */
async function showMessagePush(payload) {
  const tag = `message:${payload.conversationId}`;
  const existing = (await self.registration.getNotifications({ tag }))[0];
  // 같은 delivery가 다시 와도 카드는 띄운다. 아무것도 띄우지 않으면 브라우저가 기본 카드("백그라운드에서
  // 업데이트됨")를 대신 띄울 수 있다. 같은 카드를 조용히 다시 띄운다.
  const repeated =
    isMessageClickData(existing?.data) &&
    existing.data.deliveryId === payload.deliveryId;

  await self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "/pwa-192x192.png",
    badge: "/badge-96x96.png",
    lang: "ko",
    tag,
    renotify: !repeated,
    data: {
      conversationId: payload.conversationId,
      deliveryId: payload.deliveryId,
    },
  });
}

// 검증을 통과하지 못한 Push에 띄우는 카드의 data. 내용은 믿을 수 없으니 아무것도 싣지 않고
// 누르면 알림함만 연다.
const INBOX_CARD_DATA = { inbox: true };

function isInboxCardData(value) {
  return (
    isRecord(value) && hasExactKeys(value, ["inbox"]) && value.inbox === true
  );
}

/**
 * `userVisibleOnly` 구독은 Push마다 카드를 띄워야 한다. 그냥 버리면 브라우저가 "백그라운드에서
 * 업데이트됨" 같은 기본 카드를 대신 띄우거나, 실제 알림이 아무 흔적 없이 사라진다. 형식이 어긋난
 * 경우(서버와 이 파일의 한도가 어긋나는 등)에도 무언가 왔다는 것은 알린다.
 */
async function showInboxCard() {
  await self.registration.showNotification("새 알림", {
    body: "새 알림이 있습니다. 알림함에서 확인해 주세요.",
    icon: "/pwa-192x192.png",
    badge: "/badge-96x96.png",
    lang: "ko",
    tag: "notification-inbox",
    // 같은 tag로 덮어쓰므로, 다시 알리지 않으면 두 번째부터는 아무 표시 없이 바뀐다.
    renotify: true,
    data: INBOX_CARD_DATA,
  });
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

/** `app/features/app-shell/components/unread-badge-sync.tsx`와 같은 값이어야 한다. */
const APP_BADGE_OVERWRITTEN = "app-badge-overwritten";

/**
 * 홈 화면 아이콘 위의 숫자(Badging API).
 *
 * 앱이 떠 있을 때의 정답은 서버가 세는 안 읽은 수이고 그쪽은 앱이
 * (`app/shared/lib/app-badge.ts`) 쓴다. 여기서 세는 건 앱이 떠 있지 않은 동안 도착해 아직
 * 화면에 남아 있는 카드의 합이다 — 그 시간대에는 이쪽이 유일하게 아는 값이고, 앱이
 * 다시 열리면 게이트 로더가 곧바로 서버 값으로 덮는다. 앱 값이 알림과 메시지의 합이므로 메시지
 * 카드도 센다. 메시지 카드는 대화마다 하나로 교체되고 몇 통이 쌓였는지 싣지 않아 1로 센다.
 *
 * 보이는 창이 있으면 그 앱이 정답을 들고 있으므로 덮지 않는다. 덮었다가 되돌리면 메시지가 올
 * 때마다 숫자가 깜빡이고, 되돌리라는 메시지를 못 받은 창에서는 틀린 값이 남는다.
 *
 * 지원하지 않는 환경(데스크톱 Firefox 등)이 정상 경로에 있으므로 실패는 삼킨다. 뱃지는
 * 부가 정보라 이것 때문에 push 표시가 밀리면 안 된다.
 */
async function syncAppBadge() {
  const badging = self.navigator;
  if (!badging || typeof badging.setAppBadge !== "function") return;

  const windows = await listWindows();
  if (windows.some((client) => client.visibilityState === "visible")) return;

  try {
    const shown = await self.registration.getNotifications();
    const total = shown.reduce(
      (sum, notification) =>
        sum +
        (isClickData(notification.data)
          ? notification.data.count
          : isInboxCardData(notification.data) ||
              isMessageClickData(notification.data)
            ? 1
            : 0),
      0,
    );
    if (total > 0) await badging.setAppBadge(total);
    else await badging.clearAppBadge();
  } catch {
    // 지원하지 않거나 권한이 없는 환경.
    return;
  }
  notifyAppBadgeOverwritten(windows);
}

async function listWindows() {
  try {
    return await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
  } catch {
    return [];
  }
}

/**
 * 숨은 창에 방금 뱃지를 카드 수로 덮었다고 알린다. 앱(`UnreadBadgeSync`)은 메시지를 합친
 * 서버 값을 들고 있지만 그 값이 바뀌지 않으면 다시 쓰지 않으므로, 알리지 않으면 카드를 쓸어 지우거나
 * push가 올 때마다 뱃지가 카드 수로 남는다.
 */
function notifyAppBadgeOverwritten(windows) {
  for (const client of windows) {
    try {
      client.postMessage({ type: APP_BADGE_OVERWRITTEN });
    } catch {
      // 닫히는 중인 창이면 다음 실행에서 앱이 다시 쓴다.
    }
  }
}

async function showPush(data) {
  let payload;
  try {
    payload = data?.json();
  } catch {
    payload = undefined;
  }

  if (isMessagePushPayload(payload)) {
    await showMessagePush(payload);
    await syncAppBadge();
    return;
  }

  if (!isPushPayload(payload)) {
    await showInboxCard();
    await syncAppBadge();
    return;
  }

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

/** 창 안의 앱(`use-service-worker-navigation`)에 이동을 부탁한다. 1초 안에 답하면 맡긴다. */
function askWindowToNavigate(client, path) {
  return new Promise((resolve) => {
    let timer;
    try {
      const channel = new MessageChannel();
      timer = setTimeout(() => resolve(false), 1000);
      channel.port1.onmessage = () => {
        clearTimeout(timer);
        resolve(true);
      };
      client.postMessage({ type: "navigate", path }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

async function openNotification(data) {
  let path;
  if (isInboxCardData(data)) path = "/noti";
  else if (isMessageClickData(data)) path = `/messenger/${data.conversationId}`;
  else if (isClickData(data)) {
    path = data.count > 1 ? "/noti" : `/noti/open/${data.notificationId}`;
  } else return;

  const destination = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const appWindows = windows.filter((client) => {
    try {
      return new URL(client.url).origin === self.location.origin;
    } catch {
      return false;
    }
  });
  // 보이는 창을 먼저 쓴다. 숨은 탭을 고르면 앱이 열린 것처럼 보이지 않는다.
  const appWindow =
    appWindows.find((client) => client.visibilityState === "visible") ??
    appWindows[0];

  if (appWindow) {
    try {
      await appWindow.focus();
    } catch {
      // 포커스를 못 줘도 이동은 시도한다.
    }
    // 앱이 router로 옮겨 가면 창을 다시 불러오지 않는다. 답이 없으면 창을 그 주소로 연다.
    if (await askWindowToNavigate(appWindow, path)) return;
    // 이 워커가 제어하지 않는 창(업데이트 대기 중 등)에서는 navigate가 거부된다. 그때 카드는
    // 이미 닫혔으므로 새 창으로라도 열어야 탭이 허공에 사라지지 않는다.
    try {
      await appWindow.navigate(destination);
      return;
    } catch {
      // 아래에서 새 창을 연다.
    }
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
