import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useServiceWorker } from "~/shared/hooks/use-service-worker";

interface WorkboxEvent {
  isUpdate?: boolean;
}
type EventListener = (event: WorkboxEvent) => void;

const workboxMock = vi.hoisted(() => ({
  instances: [] as {
    listeners: Map<string, EventListener[]>;
    messageSkipWaiting: () => void;
  }[],
}));

vi.mock("workbox-window", () => ({
  Workbox: class {
    listeners = new Map<string, EventListener[]>();
    messageSkipWaiting = vi.fn();

    constructor() {
      workboxMock.instances.push(this);
    }

    addEventListener(type: string, listener: EventListener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    register = vi.fn(() => Promise.resolve(undefined));
  },
}));

const serviceWorkerDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "serviceWorker",
);

async function setupHook() {
  const reload = vi.fn();
  const view = renderHook(() => useServiceWorker(reload));

  await waitFor(() => expect(workboxMock.instances).toHaveLength(1));

  const workbox = workboxMock.instances[0];
  if (!workbox) throw new Error("Workbox was not created");

  const emit = (type: string, event: WorkboxEvent = {}) => {
    act(() => {
      for (const listener of workbox.listeners.get(type) ?? []) listener(event);
    });
  };

  return { ...view, emit, reload, workbox };
}

describe("useServiceWorker", () => {
  beforeEach(() => {
    workboxMock.instances.length = 0;
    vi.stubEnv("PROD", true);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (serviceWorkerDescriptor) {
      Object.defineProperty(
        navigator,
        "serviceWorker",
        serviceWorkerDescriptor,
      );
    } else {
      Reflect.deleteProperty(navigator, "serviceWorker");
    }
  });

  it("첫 설치에서 새로고침하지 않고 오프라인 준비 상태를 유지한다", async () => {
    const { emit, reload, result } = await setupHook();

    emit("activated", { isUpdate: false });
    emit("controlling", { isUpdate: false });

    expect(result.current.offlineReady).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it("현재 탭이 수락한 업데이트가 제어권을 얻은 뒤 새로고침한다", async () => {
    const { emit, reload, result, workbox } = await setupHook();

    emit("waiting", { isUpdate: true });
    act(() => result.current.applyUpdate());

    expect(workbox.messageSkipWaiting).toHaveBeenCalledOnce();
    expect(result.current.applyingUpdate).toBe(true);
    expect(reload).not.toHaveBeenCalled();

    emit("controlling", { isUpdate: true });
    expect(reload).toHaveBeenCalledOnce();
  });

  it("다른 탭이 적용한 업데이트는 사용자 수락 전까지 새로고침하지 않는다", async () => {
    const { emit, reload, result, workbox } = await setupHook();

    emit("controlling", { isUpdate: true });

    expect(result.current.updateReady).toBe(true);
    expect(result.current.updateAppliedElsewhere).toBe(true);
    expect(reload).not.toHaveBeenCalled();

    act(() => result.current.applyUpdate());

    expect(reload).toHaveBeenCalledOnce();
    expect(workbox.messageSkipWaiting).not.toHaveBeenCalled();
  });

  it("외부 적용 뒤 새 업데이트가 대기하면 최신 SW를 적용한다", async () => {
    const { emit, reload, result, workbox } = await setupHook();

    emit("controlling", { isUpdate: true });
    emit("waiting", { isUpdate: true });

    expect(result.current.updateAppliedElsewhere).toBe(false);
    act(() => result.current.applyUpdate());

    expect(workbox.messageSkipWaiting).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });
});
