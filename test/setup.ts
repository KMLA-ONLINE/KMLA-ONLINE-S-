import "@testing-library/jest-dom/vitest";

// Vitest runs with `globals: false`, so there is no global `afterEach` at the
// time @testing-library/react is imported and its auto-cleanup never registers.
// eslint-disable-next-line testing-library/no-manual-cleanup
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { resetQueryClientForTests } from "~/shared/lib/query-client";

afterEach(() => {
  cleanup();
  resetQueryClientForTests();
  vi.restoreAllMocks();
});

/* eslint-disable @typescript-eslint/no-empty-function --
   The stubs below exist only to satisfy `instanceof`-style feature checks;
   empty bodies are the whole point. */

// jsdom implements neither of these, and the app shell relies on both.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom은 레이아웃을 계산하지 않아 스크롤 관련 메서드를 아예 구현하지 않는다. 이미지 뷰어의
// 필름스트립처럼 활성 항목을 화면 안으로 밀어 넣는 코드는 이것이 없으면 마운트 중에 죽는다.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/* eslint-enable @typescript-eslint/no-empty-function */
