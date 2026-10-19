import { afterEach, describe, expect, it, vi } from "vitest";

import type * as InstallPlatformModule from "~/shared/lib/install-platform";
import {
  isSendEnter,
  readEnterToSend,
  writeEnterToSend,
} from "~/shared/lib/enter-to-send";

const handheld = vi.hoisted(() => ({ value: false }));
vi.mock("~/shared/lib/install-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof InstallPlatformModule>()),
  isHandheld: () => handheld.value,
}));

/** 물리 키보드는 키 위치를 `code`로 보내고 화면 키보드는 빈 문자열을 보낸다. */
const PHYSICAL_ENTER = { key: "Enter", code: "Enter", shiftKey: false };
const SOFT_ENTER = { key: "Enter", code: "", shiftKey: false };

afterEach(() => {
  handheld.value = false;
  window.localStorage.clear();
});

describe("isSendEnter", () => {
  it("데스크톱에서는 Enter로 보내고 Shift+Enter는 줄을 바꾼다", () => {
    expect(isSendEnter(PHYSICAL_ENTER, true)).toBe(true);
    expect(isSendEnter({ ...PHYSICAL_ENTER, shiftKey: true }, true)).toBe(
      false,
    );
    expect(
      isSendEnter({ ...PHYSICAL_ENTER, key: "a", code: "KeyA" }, true),
    ).toBe(false);
  });

  it("폰·태블릿은 물리 키보드의 Enter만 보낸다", () => {
    handheld.value = true;

    expect(isSendEnter(PHYSICAL_ENTER, true)).toBe(true);
    expect(isSendEnter(SOFT_ENTER, true)).toBe(false);
  });

  it("설정을 끄면 어느 기기에서도 Enter로 보내지 않는다", () => {
    expect(isSendEnter(PHYSICAL_ENTER, false)).toBe(false);
    handheld.value = true;
    expect(isSendEnter(PHYSICAL_ENTER, false)).toBe(false);
  });
});

describe("Enter로 보내기 설정", () => {
  it("저장된 값이 없으면 켜져 있고 끈 선택을 기억한다", () => {
    expect(readEnterToSend()).toBe(true);

    writeEnterToSend(false);
    expect(readEnterToSend()).toBe(false);

    writeEnterToSend(true);
    expect(readEnterToSend()).toBe(true);
  });
});
