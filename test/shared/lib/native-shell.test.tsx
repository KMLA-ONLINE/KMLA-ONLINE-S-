import { Capacitor } from "@capacitor/core";
import { describe, expect, it, vi } from "vitest";

import { isNativeShell } from "~/shared/lib/native-shell";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}));

describe("isNativeShell", () => {
  it("Capacitor가 네이티브 플랫폼에서 실행 중이라고 할 때만 true다", () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    expect(isNativeShell()).toBe(false);

    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    expect(isNativeShell()).toBe(true);
  });
});
