import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { beforeEach, describe, expect, it, vi } from "vitest";

type WorkerListener = (event: any) => void;

const validPayload = {
  notificationId: "018f3f14-9b9a-7c1d-a1b2-0123456789ab",
  deliveryId: "018f3f15-40c7-7d25-b2c3-abcdef012345",
  title: "새 알림",
  body: "확인할 새 알림이 있습니다.",
  tag: "notification:018f3f14-9b9a-7c1d-a1b2-0123456789ab",
};
const validClickData = {
  notificationId: validPayload.notificationId,
  deliveryId: validPayload.deliveryId,
};

function loadPushWorker(clients: object[] = []) {
  const listeners = new Map<string, WorkerListener>();
  const showNotification = vi.fn(() => Promise.resolve());
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
      registration: { showNotification },
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

  return { dispatch, matchAll, openWindow, showNotification };
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
      data: {
        notificationId: validPayload.notificationId,
        deliveryId: validPayload.deliveryId,
      },
    });
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
