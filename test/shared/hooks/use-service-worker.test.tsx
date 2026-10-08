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
    options: RegistrationOptions;
    update: () => Promise<void>;
  }[],
}));

vi.mock("workbox-window", () => ({
  Workbox: class {
    listeners = new Map<string, EventListener[]>();
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

function hideDocument() {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/**
 * 기본은 사용자가 이미 화면을 만진 상태다. 앱을 연 직후의 새로고침은 그것을 보는
 * 테스트에서만 일어나게 한다.
 */
async function setupHook({ interacted = true } = {}) {
  const reload = vi.fn();
  const view = renderHook(() => useServiceWorker(reload));
  if (interacted) window.dispatchEvent(new Event("pointerdown"));

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
    document.body.innerHTML = "";
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

  it("첫 설치에서 현재 페이지를 새로고침하지 않는다", async () => {
    const { emit, reload, result, workbox } = await setupHook({
      interacted: false,
    });

    expect(workbox.options).toEqual({ scope: "/", updateViaCache: "none" });

    emit("controlling", { isUpdate: false });

    expect(reload).not.toHaveBeenCalled();
    expect(result.current.updateActivated).toBe(false);
  });

  it("앱을 연 뒤 아직 만지지 않았으면 새 빌드가 활성화되자마자 새로고침한다", async () => {
    const { emit, reload } = await setupHook({ interacted: false });

    emit("controlling", { isUpdate: true });

    expect(reload).toHaveBeenCalledOnce();
  });

  it("사용 중이면 새로고침하지 않고 활성화만 알린다", async () => {
    const { emit, reload, result } = await setupHook();

    emit("controlling", { isUpdate: true });

    expect(reload).not.toHaveBeenCalled();
    expect(result.current.updateActivated).toBe(true);
  });

  it("앱이 화면에서 내려가도 새로고침하지 않는다", async () => {
    // 안드로이드에서는 사진 선택창만 열어도 페이지가 숨겨진다. 업로드 흐름을 끊지 않는다.
    const { emit, reload } = await setupHook();

    emit("controlling", { isUpdate: true });
    hideDocument();

    expect(reload).not.toHaveBeenCalled();
  });

  it("앱을 연 직후라도 작성 중인 입력이 있으면 새로고침하지 않는다", async () => {
    const input = document.createElement("input");
    input.type = "password";
    input.value = "입력 중";
    document.body.append(input);
    const { emit, reload, result } = await setupHook({ interacted: false });

    emit("controlling", { isUpdate: true });

    expect(reload).not.toHaveBeenCalled();
    expect(result.current.updateActivated).toBe(true);
  });

  it("등록이 끝나야 새 빌드 확인이 돈다고 알린다", async () => {
    const { result } = await setupHook();

    expect(result.current.updateChecksRunning).toBe(true);
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

  it("지금 확인은 쓰로틀을 건너뛴다", async () => {
    vi.spyOn(Date, "now").mockReturnValue(STARTED_AT);
    const { result, workbox } = await setupHook();

    act(() => result.current.checkForUpdateNow());

    expect(workbox.update).toHaveBeenCalledOnce();
  });
});
