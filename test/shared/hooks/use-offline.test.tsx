import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOffline } from "~/shared/hooks/use-offline";

/** 훅의 `OFFLINE_GRACE_MS`와 같은 값. 바뀌면 이쪽도 따라와야 한다. */
const GRACE_MS = 3000;

const onLineDescriptor = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  "onLine",
);

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value,
  });
}

function emit(type: "online" | "offline") {
  act(() => {
    window.dispatchEvent(new Event(type));
  });
}

describe("useOffline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setOnLine(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, "onLine");
    if (onLineDescriptor) {
      Object.defineProperty(Navigator.prototype, "onLine", onLineDescriptor);
    }
  });

  it("연결이 있으면 아무것도 알리지 않는다", () => {
    const { result } = renderHook(() => useOffline());

    expect(result.current).toBe(false);
  });

  it("끊긴 채로 유예가 지나야 알린다", () => {
    const { result } = renderHook(() => useOffline());

    setOnLine(false);
    emit("offline");
    expect(result.current).toBe(false);

    act(() => void vi.advanceTimersByTime(GRACE_MS));
    expect(result.current).toBe(true);
  });

  it("유예 안에 돌아온 깜빡임은 알리지 않는다", () => {
    const { result } = renderHook(() => useOffline());

    setOnLine(false);
    emit("offline");

    act(() => void vi.advanceTimersByTime(GRACE_MS - 1));
    setOnLine(true);
    emit("online");

    act(() => void vi.advanceTimersByTime(GRACE_MS * 2));
    expect(result.current).toBe(false);
  });

  it("연결이 돌아오면 유예 없이 내린다", () => {
    const { result } = renderHook(() => useOffline());

    setOnLine(false);
    emit("offline");
    act(() => void vi.advanceTimersByTime(GRACE_MS));
    expect(result.current).toBe(true);

    setOnLine(true);
    emit("online");
    expect(result.current).toBe(false);
  });

  it("이미 끊긴 채로 마운트해도 알린다", () => {
    setOnLine(false);
    const { result } = renderHook(() => useOffline());

    act(() => void vi.advanceTimersByTime(GRACE_MS));

    expect(result.current).toBe(true);
  });

  it("언마운트한 뒤에는 상태를 건드리지 않는다", () => {
    const { unmount } = renderHook(() => useOffline());

    setOnLine(false);
    emit("offline");
    unmount();

    // 남은 타이머가 살아 있으면 여기서 언마운트된 훅의 setState가 터진다.
    expect(() =>
      act(() => void vi.advanceTimersByTime(GRACE_MS)),
    ).not.toThrow();
  });
});
