import { afterEach, describe, expect, it, vi } from "vitest";

import { isNetworkError } from "~/shared/lib/network-error";

describe("isNetworkError", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    new TypeError("Failed to fetch"),
    new TypeError("NetworkError when attempting to fetch resource."),
    new TypeError("Load failed"),
    // PostgREST 클라이언트가 fetch 실패를 감싸 돌려주는 모양.
    { message: "TypeError: Failed to fetch", code: "", details: "" },
    Object.assign(new Error("fetch failed"), {
      name: "AuthRetryableFetchError",
    }),
  ])("treats a fetch failure as a network error: %o", (error) => {
    expect(isNetworkError(error)).toBe(true);
  });

  it.each([
    new Error("permission denied for table profiles"),
    { message: "JWT expired", code: "PGRST301" },
    null,
    "Failed",
  ])("leaves server-side failures alone: %o", (error) => {
    expect(isNetworkError(error)).toBe(false);
  });

  it("treats any failure as a network error while the browser is offline", () => {
    vi.stubGlobal("navigator", { onLine: false });

    expect(isNetworkError(new Error("anything"))).toBe(true);
  });
});
