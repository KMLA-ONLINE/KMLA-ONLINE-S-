import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useKeyboardViewport } from "~/features/posts/hooks/use-keyboard-viewport";

class TestVisualViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  scale = 1;
}

const originalInnerHeight = window.innerHeight;
const originalVisualViewport = window.visualViewport;

let visualViewport: TestVisualViewport;

beforeEach(() => {
  visualViewport = new TestVisualViewport();
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: visualViewport,
  });
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
});

afterEach(() => {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: originalInnerHeight,
  });
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: originalVisualViewport,
  });
});

describe("useKeyboardViewport", () => {
  it("positions the sheet above a visual-viewport keyboard", () => {
    visualViewport.height = 500;

    const { result } = renderHook(() => useKeyboardViewport(true));

    expect(result.current).toEqual({
      keyboardOpen: true,
      bottomInset: 300,
      height: 500,
    });
  });

  it("does not double-correct a resized layout viewport", () => {
    const { result } = renderHook(() => useKeyboardViewport(true));

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 500,
    });
    visualViewport.height = 500;
    act(() => {
      visualViewport.dispatchEvent(new Event("resize"));
    });

    expect(result.current).toEqual({
      keyboardOpen: false,
      bottomInset: 0,
      height: 500,
    });
  });

  it("accounts for a visual viewport panned by the browser", () => {
    const { result } = renderHook(() => useKeyboardViewport(true));

    visualViewport.height = 500;
    visualViewport.offsetTop = 100;
    act(() => {
      visualViewport.dispatchEvent(new Event("scroll"));
    });

    expect(result.current).toEqual({
      keyboardOpen: true,
      bottomInset: 200,
      height: 500,
    });
  });

  it("still reports the keyboard once the browser pans it fully into view", () => {
    const { result } = renderHook(() => useKeyboardViewport(true));

    // 안드로이드 Chrome: 키보드 높이만큼 화면을 끌어올려 가려진 아래쪽이 남지 않는다.
    visualViewport.height = 500;
    visualViewport.offsetTop = 300;
    act(() => {
      visualViewport.dispatchEvent(new Event("resize"));
    });

    expect(result.current).toEqual({
      keyboardOpen: true,
      bottomInset: 0,
      height: 500,
    });
  });

  it("ignores browser chrome changes and pinch zoom", () => {
    visualViewport.height = 760;
    const { result } = renderHook(() => useKeyboardViewport(true));

    expect(result.current).toEqual({
      keyboardOpen: false,
      bottomInset: 0,
      height: 760,
    });

    visualViewport.scale = 1.5;
    act(() => {
      visualViewport.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toEqual({
      keyboardOpen: false,
      bottomInset: 0,
      height: null,
    });
  });

  it("does nothing while disabled", () => {
    visualViewport.height = 500;

    const { result } = renderHook(() => useKeyboardViewport(false));

    expect(result.current).toEqual({
      keyboardOpen: false,
      bottomInset: 0,
      height: null,
    });
  });
});
