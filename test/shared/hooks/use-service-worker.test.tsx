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
    options: RegistrationOptions;
    update: () => Promise<void>;
  }[],
}));

vi.mock("workbox-window", () => ({
  Workbox: class {
    listeners = new Map<string, EventListener[]>();
    messageSkipWaiting = vi.fn();
    options: RegistrationOptions;

    constructor(_scriptUrl: string, options: RegistrationOptions) {
      this.options = options;
      workboxMock.instances.push(this);
    }

    addEventListener(type: string, listener: EventListener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    register = vi.fn(() => Promise.resolve(undefined));
    update = vi.fn(() => Promise.resolve());
  },
}));

const serviceWorkerDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "serviceWorker",
);

/** 훅이 `Date.now()`로 쓰로틀을 재기 때문에 시계를 고정해 두고 앞으로 감는다. */
const STARTED_AT = 1_800_000_000_000;
const PAST_THROTTLE_MS = 6 * 60 * 1000;

/** 훅의 `APPLY_UPDATE_TIMEOUT_MS`와 같은 값. 바뀌면 이쪽도 따라와야 한다. */
const APPLY_UPDATE_TIMEOUT_MS = 5000;

async function setupHook() {
  const reload = vi.fn();
  const view = renderHook(() => useServiceWorker(reload));

  await waitFor(() => expect(workboxMock.instances).toHaveLength(1));

  const workbox = workboxMock.instances[0];
  if (!workbox) throw new Error("Workbox was not created");

  // 업데이트 확인 리스너는 `register()`가 끝난 뒤에 붙는다. 매크로태스크를 한 번
  // 흘려보내 그 지점을 지나게 한다. 여기서 바뀌는 상태는 없어 act가 필요 없다.
  await new Promise((resolve) => setTimeout(resolve, 0));

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
    vi.useRealTimers();
    vi.unstubAllEnvs();
    Reflect.deleteProperty(document, "visibilityState");
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
    const { emit, reload, result, workbox } = await setupHook();

    expect(workbox.options).toEqual({ scope: "/", updateViaCache: "none" });

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

  it("적용이 응답 없이 멈추면 새로고침으로 빠져나온다", async () => {
    const { emit, reload, result } = await setupHook();

    emit("waiting", { isUpdate: true });

    vi.useFakeTimers();
    act(() => result.current.applyUpdate());
    expect(reload).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(APPLY_UPDATE_TIMEOUT_MS));

    expect(reload).toHaveBeenCalledOnce();
  });

  it("제때 적용되면 예비 새로고침을 취소한다", async () => {
    const { emit, reload, result } = await setupHook();

    emit("waiting", { isUpdate: true });

    vi.useFakeTimers();
    act(() => result.current.applyUpdate());
    emit("controlling", { isUpdate: true });

    expect(reload).toHaveBeenCalledOnce();

    act(() => void vi.advanceTimersByTime(APPLY_UPDATE_TIMEOUT_MS * 2));

    expect(reload).toHaveBeenCalledOnce();
  });

  it("탭이 다시 보이면 새 빌드가 나왔는지 확인한다", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(STARTED_AT);
    const { workbox } = await setupHook();

    // 등록이 방금 sw.js를 받아왔으므로 곧바로 돌아온 탭은 다시 묻지 않는다.
    document.dispatchEvent(new Event("visibilitychange"));
    expect(workbox.update).not.toHaveBeenCalled();

    now.mockReturnValue(STARTED_AT + PAST_THROTTLE_MS);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(workbox.update).toHaveBeenCalledOnce();

    // 앱을 짧게 오가는 동안 확인이 매번 나가지는 않는다.
    document.dispatchEvent(new Event("visibilitychange"));
    expect(workbox.update).toHaveBeenCalledOnce();
  });

  it("숨어 있는 탭에서는 확인하지 않는다", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(STARTED_AT);
    const { workbox } = await setupHook();

    now.mockReturnValue(STARTED_AT + PAST_THROTTLE_MS);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(workbox.update).not.toHaveBeenCalled();
  });

  it("언마운트한 뒤에는 확인을 멈춘다", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(STARTED_AT);
    const { unmount, workbox } = await setupHook();

    unmount();
    now.mockReturnValue(STARTED_AT + PAST_THROTTLE_MS);
    document.dispatchEvent(new Event("visibilitychange"));

    expect(workbox.update).not.toHaveBeenCalled();
  });
});
