import "@testing-library/jest-dom/vitest";

// Vitest runs with `globals: false`, so there is no global `afterEach` at the
// time @testing-library/react is imported and its auto-cleanup never registers.
// eslint-disable-next-line testing-library/no-manual-cleanup
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
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

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/* eslint-enable @typescript-eslint/no-empty-function */
