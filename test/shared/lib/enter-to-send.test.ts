import { afterEach, describe, expect, it, vi } from "vitest";

import type * as InstallPlatformModule from "~/shared/lib/install-platform";
import { isSendEnter } from "~/shared/lib/enter-to-send";

const handheld = vi.hoisted(() => ({ value: false }));
vi.mock("~/shared/lib/install-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof InstallPlatformModule>()),
  isHandheld: () => handheld.value,
}));

const ENTER = { key: "Enter", shiftKey: false };
/** iOS 화면 키보드의 Return은 물리 키처럼 `code: "Enter"`로 온다. Android 화면 키보드는 빈 문자열이다. */
const IOS_SOFT_ENTER = { key: "Enter", code: "Enter", shiftKey: false };
const ANDROID_SOFT_ENTER = { key: "Enter", code: "", shiftKey: false };

afterEach(() => {
  handheld.value = false;
});

describe("isSendEnter", () => {
  it("데스크톱에서는 Enter로 보내고 Shift+Enter는 줄을 바꾼다", () => {
    expect(isSendEnter(ENTER)).toBe(true);
    expect(isSendEnter({ ...ENTER, shiftKey: true })).toBe(false);
    expect(isSendEnter({ ...ENTER, key: "a" })).toBe(false);
  });

  it("폰·태블릿에서는 Enter가 보내지 않고 줄을 바꾼다", () => {
    handheld.value = true;

    expect(isSendEnter(IOS_SOFT_ENTER)).toBe(false);
    expect(isSendEnter(ANDROID_SOFT_ENTER)).toBe(false);
  });
});
