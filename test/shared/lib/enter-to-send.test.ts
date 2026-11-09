import { afterEach, describe, expect, it, vi } from "vitest";

import { isSendEnter } from "~/shared/lib/enter-to-send";

const desktopPointer = vi.hoisted(() => ({ value: true }));
vi.mock("~/shared/lib/desktop-pointer", () => ({
  hasDesktopPointer: () => desktopPointer.value,
}));

const ENTER = { key: "Enter", shiftKey: false };
/** iOS 화면 키보드의 Return은 물리 키처럼 `code: "Enter"`로 온다. Android 화면 키보드는 빈 문자열이다. */
const IOS_SOFT_ENTER = { key: "Enter", code: "Enter", shiftKey: false };
const ANDROID_SOFT_ENTER = { key: "Enter", code: "", shiftKey: false };

afterEach(() => {
  desktopPointer.value = true;
});

describe("isSendEnter", () => {
  it("마우스·트랙패드가 주 입력인 컴퓨터에서는 Enter로 보내고 Shift+Enter는 줄을 바꾼다", () => {
    expect(isSendEnter(ENTER)).toBe(true);
    expect(isSendEnter({ ...ENTER, shiftKey: true })).toBe(false);
    expect(isSendEnter({ ...ENTER, key: "a" })).toBe(false);
  });

  it("주 입력이 터치면 UA와 상관없이 Enter가 줄을 바꾼다", () => {
    // 데스크톱 사이트를 요청하는 갤럭시 탭은 UA에 `Android`가 없다. jsdom의 UA도 컴퓨터다.
    desktopPointer.value = false;

    expect(isSendEnter(IOS_SOFT_ENTER)).toBe(false);
    expect(isSendEnter(ANDROID_SOFT_ENTER)).toBe(false);
  });
});
