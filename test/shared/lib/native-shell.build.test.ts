import { describe, expect, it, vi } from "vitest";

import { isNativeShell } from "~/shared/lib/native-shell";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));

// 빌드 타임 렌더(`react-router build`의 SPA index.html)는 Node에서 돌고 `window`가 없다.
describe("isNativeShell (빌드 타임 렌더)", () => {
  it("window가 없으면 Capacitor가 뭐라 하든 false다", () => {
    expect(typeof window).toBe("undefined");
    expect(isNativeShell()).toBe(false);
  });
});
