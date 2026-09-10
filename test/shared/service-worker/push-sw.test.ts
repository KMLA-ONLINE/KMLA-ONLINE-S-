import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { beforeEach, describe, expect, it, vi } from "vitest";

type WorkerListener = (event: any) => void;

const validPayload = {
  notificationId: "018f3f14-9b9a-7c1d-a1b2-0123456789ab",
  deliveryId: "018f3f15-40c7-7d25-b2c3-abcdef012345",
  groupingKey: "018f3f16-40c7-7d25-b2c3-abcdef012345",
  importance: "normal",
  category: "content",
  title: "새 알림",
  body: "확인할 새 알림이 있습니다.",
  tag: "notification-category:content:018f3f16-40c7-7d25-b2c3-abcdef012345",
};
const validClickData = {
  notificationId: validPayload.notificationId,
  deliveryIds: [validPayload.deliveryId],
  count: 1,
};

function loadPushWorker(
  clients: object[] = [],
  { badging = true }: { badging?: boolean } = {},
) {
  const listeners = new Map<string, WorkerListener>();
  const notifications: {
    data: Record<string, unknown>;
    tag: string;
  }[] = [];
  // 필터 없는 호출은 지금 떠 있는 카드 전부를 준다 — 뱃지 합계가 그 경로를 쓴다.
  const getNotifications = vi.fn((filter?: { tag: string }) =>
    Promise.resolve(
      filter
        ? notifications.filter((item) => item.tag === filter.tag)
        : [...notifications],
    ),
  );
  const showNotification = vi.fn(
    (
      _title: string,
      options: { data: Record<string, unknown>; tag: string },
    ) => {
      const existingIndex = notifications.findIndex(
        (item) => item.tag === options.tag,
      );
      const notification = { data: options.data, tag: options.tag };
      if (existingIndex === -1) notifications.push(notification);
      else notifications[existingIndex] = notification;
      return Promise.resolve();
    },
  );
  const matchAll = vi.fn(() => Promise.resolve(clients));
  const openWindow = vi.fn(() => Promise.resolve());
  const setAppBadge = vi.fn(() => Promise.resolve());
  const clearAppBadge = vi.fn(() => Promise.resolve());
  const subscribe = vi.fn(() => Promise.resolve({}));
  const source = readFileSync(
    resolve(process.cwd(), "public/push-sw.js"),
    "utf8",
  );

  runInNewContext(source, {
    URL,
    self: {
      location: { origin: "https://kmla.example" },
      // 데스크톱 Firefox처럼 Badging API가 없는 환경도 정상 경로다.
      navigator: badging ? { setAppBadge, clearAppBadge } : {},
      registration: {
        getNotifications,
        showNotification,
        pushManager: { subscribe },
      },
      clients: { matchAll, openWindow },
      addEventListener(type: string, listener: WorkerListener) {
        listeners.set(type, listener);
      },
    },
  });

  async function dispatch(type: string, event: Record<string, unknown>) {
    let pending: Promise<unknown> | undefined;
    listeners.get(type)?.({
      ...event,
      waitUntil(promise: Promise<unknown>) {
        pending = promise;
      },
    });
    await pending;
  }

  return {
    clearAppBadge,
    dispatch,
    matchAll,
    notifications,
    openWindow,
    setAppBadge,
    showNotification,
    subscribe,
  };
}

describe("public push service worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a validated push with fixed local assets and stable identifiers", async () => {
    const worker = loadPushWorker();

    await worker.dispatch("push", {
      data: { json: () => validPayload },
    });

    expect(worker.showNotification).toHaveBeenCalledWith("새 알림", {
      body: "확인할 새 알림이 있습니다.",
      icon: "/pwa-192x192.png",
      badge: "/badge-96x96.png",
      lang: "ko",
      tag: validPayload.tag,
      renotify: false,
      data: {
        notificationId: validPayload.notificationId,
        deliveryIds: [validPayload.deliveryId],
        count: 1,
      },
    });
  });

  it("replaces normal notifications by category and opens grouped cards in the inbox", async () => {
    const worker = loadPushWorker();
    await worker.dispatch("push", { data: { json: () => validPayload } });
    await worker.dispatch("push", {
      data: {
        json: () => ({
          ...validPayload,
          notificationId: "028f3f14-9b9a-7c1d-a1b2-0123456789ab",
          deliveryId: "028f3f15-40c7-7d25-b2c3-abcdef012345",
          title: "또 다른 알림",
        }),
      },
    });

    expect(worker.notifications).toHaveLength(1);
    expect(worker.showNotification).toHaveBeenLastCalledWith(
      "콘텐츠 알림 2개",
      expect.objectContaining({
        body: "또 다른 알림 외 1개의 알림이 있습니다.",
        renotify: true,
        data: expect.objectContaining({ count: 2 }),
      }),
    );

    await worker.dispatch("notificationclick", {
      notification: {
        close: vi.fn(),
        data: worker.notifications[0]?.data,
      },
    });
    expect(worker.openWindow).toHaveBeenCalledWith("/noti");
  });

  it("does not increment a category card for an out-of-order repeated delivery", async () => {
    const worker = loadPushWorker();
    await worker.dispatch("push", { data: { json: () => validPayload } });
    const secondPayload = {
      ...validPayload,
      notificationId: "028f3f14-9b9a-7c1d-a1b2-0123456789ab",
      deliveryId: "028f3f15-40c7-7d25-b2c3-abcdef012345",
      title: "또 다른 알림",
    };
    await worker.dispatch("push", { data: { json: () => secondPayload } });
    await worker.dispatch("push", { data: { json: () => validPayload } });

    expect(worker.showNotification).toHaveBeenCalledTimes(2);
    expect(worker.showNotification).toHaveBeenLastCalledWith(
      "콘텐츠 알림 2개",
      expect.objectContaining({
        body: "또 다른 알림 외 1개의 알림이 있습니다.",
        data: expect.objectContaining({ count: 2 }),
      }),
    );
  });

  it("serializes concurrent pushes before updating a category card", async () => {
    const worker = loadPushWorker();
    const secondPayload = {
      ...validPayload,
      notificationId: "028f3f14-9b9a-7c1d-a1b2-0123456789ab",
      deliveryId: "028f3f15-40c7-7d25-b2c3-abcdef012345",
    };

    await Promise.all([
      worker.dispatch("push", { data: { json: () => validPayload } }),
      worker.dispatch("push", { data: { json: () => secondPayload } }),
    ]);

    expect(worker.notifications).toHaveLength(1);
    expect(worker.notifications[0]?.data).toMatchObject({ count: 2 });
  });

  it("keeps category cards separate between browser subscriptions", async () => {
    const worker = loadPushWorker();
    const otherSubscription = {
      ...validPayload,
      notificationId: "028f3f14-9b9a-7c1d-a1b2-0123456789ab",
      deliveryId: "028f3f15-40c7-7d25-b2c3-abcdef012345",
      groupingKey: "028f3f16-40c7-7d25-b2c3-abcdef012345",
      tag: "notification-category:content:028f3f16-40c7-7d25-b2c3-abcdef012345",
    };

    await worker.dispatch("push", { data: { json: () => validPayload } });
    await worker.dispatch("push", {
      data: { json: () => otherSubscription },
    });

    expect(worker.notifications).toHaveLength(2);
  });

  it("keeps high importance notifications on unique tags", async () => {
    const worker = loadPushWorker();
    const highPayload = {
      ...validPayload,
      importance: "high",
      category: "account",
      tag: `notification:${validPayload.notificationId}`,
    };

    await worker.dispatch("push", { data: { json: () => highPayload } });

    expect(worker.showNotification).toHaveBeenCalledWith(
      "새 알림",
      expect.objectContaining({ tag: highPayload.tag, renotify: false }),
    );
  });

  it.each([
    ["missing data", undefined],
    [
      "invalid JSON",
      {
        json: () => {
          throw new Error("invalid");
        },
      },
    ],
    ["non-object payload", { json: () => "payload" }],
    [
      "invalid notification ID",
      { json: () => ({ ...validPayload, notificationId: "1" }) },
    ],
    [
      "invalid grouping key",
      { json: () => ({ ...validPayload, groupingKey: "1" }) },
    ],
    ["blank title", { json: () => ({ ...validPayload, title: " " }) }],
    [
      "unstable notification tag",
      { json: () => ({ ...validPayload, tag: "notification:other" }) },
    ],
    [
      "unknown importance",
      { json: () => ({ ...validPayload, importance: "urgent" }) },
    ],
    [
      "unknown category",
      { json: () => ({ ...validPayload, category: "unknown" }) },
    ],
    [
      "arbitrary URL field",
      { json: () => ({ ...validPayload, url: "https://evil.example" }) },
    ],
  ])("ignores %s", async (_case, data) => {
    const worker = loadPushWorker();

    await worker.dispatch("push", { data });

    expect(worker.showNotification).not.toHaveBeenCalled();
  });

  it("focuses and navigates an existing app window to the local resolver", async () => {
    const order: string[] = [];
    const appClient = {
      url: "https://kmla.example/groups/1",
      focus: vi.fn(() => {
        order.push("focus");
        return Promise.resolve();
      }),
      navigate: vi.fn((url: string) => {
        order.push(`navigate:${url}`);
        return Promise.resolve();
      }),
    };
    const worker = loadPushWorker([appClient]);
    const close = vi.fn();

    await worker.dispatch("notificationclick", {
      notification: { close, data: validClickData },
    });

    expect(close).toHaveBeenCalledOnce();
    expect(order).toEqual([
      "focus",
      `navigate:https://kmla.example/noti/open/${validPayload.notificationId}`,
    ]);
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it("opens the local resolver when no app window exists", async () => {
    const worker = loadPushWorker([
      {
        url: "https://other.example/",
        focus: vi.fn(),
        navigate: vi.fn(),
      },
    ]);

    await worker.dispatch("notificationclick", {
      notification: { close: vi.fn(), data: validClickData },
    });

    expect(worker.matchAll).toHaveBeenCalledWith({
      type: "window",
      includeUncontrolled: true,
    });
    expect(worker.openWindow).toHaveBeenCalledWith(
      `/noti/open/${validPayload.notificationId}`,
    );
  });

  it("counts every shown card into the app icon badge", async () => {
    const worker = loadPushWorker();

    await worker.dispatch("push", { data: { json: () => validPayload } });
    expect(worker.setAppBadge).toHaveBeenLastCalledWith(1);

    // 같은 카테고리라 카드는 하나로 합쳐지지만 뱃지는 알림 수를 센다.
    await worker.dispatch("push", {
      data: {
        json: () => ({
          ...validPayload,
          notificationId: "028f3f14-9b9a-7c1d-a1b2-0123456789ab",
          deliveryId: "028f3f15-40c7-7d25-b2c3-abcdef012345",
        }),
      },
    });
    expect(worker.notifications).toHaveLength(1);
    expect(worker.setAppBadge).toHaveBeenLastCalledWith(2);
    expect(worker.clearAppBadge).not.toHaveBeenCalled();
  });

  it("clears the app icon badge once no card is left", async () => {
    const worker = loadPushWorker();
    await worker.dispatch("push", { data: { json: () => validPayload } });

    worker.notifications.length = 0;
    await worker.dispatch("notificationclose", {
      notification: { data: validClickData },
    });

    expect(worker.clearAppBadge).toHaveBeenCalledOnce();
  });

  it("does not fail a push when the browser has no Badging API", async () => {
    const worker = loadPushWorker([], { badging: false });

    await worker.dispatch("push", { data: { json: () => validPayload } });

    expect(worker.showNotification).toHaveBeenCalledOnce();
  });

  it("resubscribes with the previous options when the push subscription rotates", async () => {
    const worker = loadPushWorker();
    const options = { userVisibleOnly: true, applicationServerKey: "key" };

    await worker.dispatch("pushsubscriptionchange", {
      oldSubscription: { options },
    });

    expect(worker.subscribe).toHaveBeenCalledWith(options);
  });

  it("ignores a subscription change that carries no previous options", async () => {
    const worker = loadPushWorker();

    await worker.dispatch("pushsubscriptionchange", {
      oldSubscription: undefined,
    });

    expect(worker.subscribe).not.toHaveBeenCalled();
  });

  it("ignores click data that was not produced by a validated push", async () => {
    const worker = loadPushWorker();

    await worker.dispatch("notificationclick", {
      notification: {
        close: vi.fn(),
        data: { ...validClickData, notificationId: "../../admin" },
      },
    });

    expect(worker.matchAll).not.toHaveBeenCalled();
    expect(worker.openWindow).not.toHaveBeenCalled();
  });
});
