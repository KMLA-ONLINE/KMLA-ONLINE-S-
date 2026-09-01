import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { beforeEach, describe, expect, it, vi } from "vitest";

type WorkerListener = (event: any) => void;

const validPayload = {
  notificationId: "018f3f14-9b9a-7c1d-a1b2-0123456789ab",
  deliveryId: "018f3f15-40c7-7d25-b2c3-abcdef012345",
  importance: "normal",
  category: "content",
  title: "새 알림",
  body: "확인할 새 알림이 있습니다.",
  tag: "notification-category:content",
};
const validClickData = {
  notificationId: validPayload.notificationId,
  deliveryId: validPayload.deliveryId,
  count: 1,
};

function loadPushWorker(clients: object[] = []) {
  const listeners = new Map<string, WorkerListener>();
  const notifications: {
    data: Record<string, unknown>;
    tag: string;
  }[] = [];
  const getNotifications = vi.fn(({ tag }: { tag: string }) =>
    Promise.resolve(notifications.filter((item) => item.tag === tag)),
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
  const source = readFileSync(
    resolve(process.cwd(), "public/push-sw.js"),
    "utf8",
  );

  runInNewContext(source, {
    URL,
    self: {
      location: { origin: "https://kmla.example" },
      registration: { getNotifications, showNotification },
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
    dispatch,
    getNotifications,
    matchAll,
    notifications,
    openWindow,
    showNotification,
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
      tag: validPayload.tag,
      renotify: false,
      data: {
        notificationId: validPayload.notificationId,
        deliveryId: validPayload.deliveryId,
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

  it("does not increment a grouped card for a repeated delivery", async () => {
    const worker = loadPushWorker();
    await worker.dispatch("push", { data: { json: () => validPayload } });
    await worker.dispatch("push", { data: { json: () => validPayload } });

    expect(worker.showNotification).toHaveBeenLastCalledWith(
      "새 알림",
      expect.objectContaining({
        renotify: false,
        data: expect.objectContaining({ count: 1 }),
      }),
    );
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
