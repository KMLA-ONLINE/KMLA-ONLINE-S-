import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInstallPrompt } from "~/shared/hooks/use-install-prompt";
import { getInstallPreference } from "~/shared/lib/install-platform";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_KAKAO = `${IPHONE_SAFARI} KAKAOTALK 10.5.0`;
const IPHONE_CHROME_17 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME_16_3 = IPHONE_CHROME_17.replace("OS 17_5", "OS 16_3");
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const ANDROID_KAKAO =
  "Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 KAKAOTALK 10.5.0";
const ANDROID_SAMSUNG =
  "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const IPAD_SAFARI_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const overriddenNavigatorKeys: string[] = [];

function stubNavigator(key: string, value: unknown) {
  overriddenNavigatorKeys.push(key);
  Object.defineProperty(navigator, key, { configurable: true, value });
}

/**
 * jsdom의 `matchMedia`는 무엇을 묻든 `matches: false`다. 훅이 보는 쿼리만 골라 답한다.
 */
function stubMedia(matching: string[]) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({ matches: matching.includes(query) }) as MediaQueryList,
  );
}

interface PlatformOptions {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  coarsePointer?: boolean;
}

function usePlatform({
  userAgent,
  platform = "",
  maxTouchPoints = 5,
  standalone = false,
  coarsePointer = true,
}: PlatformOptions) {
  stubNavigator("userAgent", userAgent);
  stubNavigator("platform", platform);
  stubNavigator("maxTouchPoints", maxTouchPoints);

  const media = coarsePointer ? ["(any-pointer: coarse)"] : [];
  if (standalone) media.push("(display-mode: standalone)");
  stubMedia(media);
}

/** 렌더 후 노출 타이머까지 흘려보낸다. */
function renderRevealed() {
  const view = renderHook(() => useInstallPrompt());
  act(() => {
    vi.runAllTimers();
  });
  return view;
}

function fireBeforeInstallPrompt(
  outcome: "accepted" | "dismissed" = "accepted",
) {
  // preventDefault()가 실제로 기록되려면 취소 가능한 이벤트여야 한다.
  const event = Object.assign(
    new Event("beforeinstallprompt", { cancelable: true }),
    {
      prompt: vi.fn(() => Promise.resolve()),
      userChoice: Promise.resolve({ outcome }),
    },
  );

  act(() => {
    window.dispatchEvent(event);
  });

  return event;
}

describe("useInstallPrompt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const key of overriddenNavigatorKeys.splice(0)) {
      Reflect.deleteProperty(navigator, key);
    }
  });

  it("데스크톱에서는 beforeinstallprompt가 와도 띄우지 않는다", () => {
    usePlatform({ userAgent: MAC_CHROME, coarsePointer: false });

    const { result } = renderRevealed();
    fireBeforeInstallPrompt();

    expect(result.current.open).toBe(false);
    expect(result.current.mode).toBeNull();
  });

  it("이미 설치된 창(standalone)에서는 띄우지 않는다", () => {
    usePlatform({ userAgent: IPHONE_SAFARI, standalone: true });

    const { result } = renderRevealed();

    expect(result.current.open).toBe(false);
    expect(getInstallPreference().installed).toBe(true);
  });

  it("설치 기록이 남아 있으면 띄우지 않는다", () => {
    usePlatform({ userAgent: ANDROID_CHROME });
    localStorage.setItem(
      "kmla-online:pwa-install-preference",
      JSON.stringify({ installed: true }),
    );

    const { result } = renderRevealed();

    expect(result.current.open).toBe(false);
  });

  it("설치 기록 뒤 브라우저가 설치 이벤트를 다시 주면 재설치를 안내한다", () => {
    usePlatform({ userAgent: ANDROID_CHROME });
    localStorage.setItem(
      "kmla-online:pwa-install-preference",
      JSON.stringify({ installed: true }),
    );

    const { result } = renderHook(() => useInstallPrompt());
    fireBeforeInstallPrompt();
    act(() => {
      vi.runAllTimers();
    });

    expect(getInstallPreference().installed).toBe(false);
    expect(result.current.mode).toBe("install");
    expect(result.current.open).toBe(true);
  });

  it("Android에서 beforeinstallprompt를 받으면 install 모드로 연다", () => {
    usePlatform({ userAgent: ANDROID_CHROME });

    const { result } = renderHook(() => useInstallPrompt());
    const event = fireBeforeInstallPrompt();
    act(() => {
      vi.runAllTimers();
    });

    expect(event.defaultPrevented).toBe(true);
    expect(result.current.mode).toBe("install");
    expect(result.current.open).toBe(true);
  });

  it("Android에서 이벤트가 오지 않으면 수동 안내로 떨어진다", () => {
    usePlatform({ userAgent: ANDROID_CHROME });

    const { result } = renderRevealed();

    expect(result.current.mode).toBe("android-help");
  });

  it("Android 인앱 브라우저는 android-other 모드로 연다", () => {
    usePlatform({ userAgent: ANDROID_KAKAO });

    const { result } = renderRevealed();

    expect(result.current.mode).toBe("android-other");
  });

  it("삼성 인터넷은 인앱이 아니라 설치 메뉴를 안내한다", () => {
    usePlatform({ userAgent: ANDROID_SAMSUNG });

    const { result } = renderRevealed();

    expect(result.current.mode).toBe("android-help");
  });

  it("iOS Safari는 ios-browser 모드로 연다", () => {
    usePlatform({ userAgent: IPHONE_SAFARI });

    const { result } = renderRevealed();

    expect(result.current.mode).toBe("ios-browser");
  });

  it("iOS 16.4 이상 Chrome은 공유 메뉴 설치를 안내한다", () => {
    usePlatform({ userAgent: IPHONE_CHROME_17 });

    const { result } = renderRevealed();

    expect(result.current.mode).toBe("ios-browser");
  });

  it("iOS 16.4 미만 Chrome은 Safari 열기를 안내한다", () => {
    usePlatform({ userAgent: IPHONE_CHROME_16_3 });

    const { result } = renderRevealed();

    expect(result.current.mode).toBe("ios-other");
  });

  it("iOS 인앱 브라우저는 ios-other 모드로 연다", () => {
    usePlatform({ userAgent: IPHONE_KAKAO });

    const { result } = renderRevealed();

    expect(result.current.mode).toBe("ios-other");
  });

  it("iPadOS는 데스크톱 UA를 보내도 iOS로 인식한다", () => {
    usePlatform({
      userAgent: IPAD_SAFARI_DESKTOP,
      platform: "MacIntel",
      maxTouchPoints: 5,
    });

    const { result } = renderRevealed();

    expect(result.current.mode).toBe("ios-browser");
  });

  it("나중에를 누르면 현재 방문에서만 숨긴다", () => {
    usePlatform({ userAgent: IPHONE_SAFARI });

    const view = renderRevealed();
    act(() => view.result.current.dismiss());

    expect(view.result.current.open).toBe(false);
    expect(getInstallPreference().dismissCount).toBe(1);

    act(() => {
      vi.runAllTimers();
    });
    expect(view.result.current.open).toBe(false);

    view.unmount();
    const { result: nextResult } = renderRevealed();
    expect(nextResult.current.open).toBe(true);
  });

  it("네 번째 나중에부터 영구 숨김 여부를 확인한다", () => {
    usePlatform({ userAgent: IPHONE_SAFARI });

    let view = renderRevealed();
    for (let count = 1; count <= 3; count += 1) {
      act(() => {
        view.result.current.dismiss();
      });
      expect(getInstallPreference().dismissCount).toBe(count);
      expect(view.result.current.confirmingNeverShow).toBe(false);
      view.unmount();
      view = renderRevealed();
    }

    act(() => view.result.current.dismiss());
    expect(view.result.current.confirmingNeverShow).toBe(true);
    expect(getInstallPreference().dismissCount).toBe(4);

    act(() => view.result.current.neverShow());
    expect(view.result.current.open).toBe(false);
    expect(getInstallPreference().neverShow).toBe(true);
  });

  it("저장소가 차단돼도 네 번째 거절과 영구 숨김이 동작한다", () => {
    usePlatform({ userAgent: IPHONE_SAFARI });
    getInstallPreference();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    let view = renderRevealed();
    for (let count = 1; count <= 3; count += 1) {
      act(() => view.result.current.dismiss());
      expect(getInstallPreference().dismissCount).toBe(count);
      view.unmount();
      view = renderRevealed();
    }

    act(() => view.result.current.dismiss());
    expect(view.result.current.confirmingNeverShow).toBe(true);

    act(() => view.result.current.neverShow());
    act(() => {
      vi.runAllTimers();
    });
    expect(view.result.current.open).toBe(false);
    expect(getInstallPreference().neverShow).toBe(true);
  });

  it("설치를 수락하면 기록하고 닫는다", async () => {
    usePlatform({ userAgent: ANDROID_CHROME });

    const { result } = renderHook(() => useInstallPrompt());
    const event = fireBeforeInstallPrompt();
    act(() => {
      vi.runAllTimers();
    });

    await act(async () => {
      await result.current.install();
    });

    expect(event.prompt).toHaveBeenCalledOnce();
    expect(getInstallPreference().installed).toBe(true);
    expect(result.current.open).toBe(false);
  });

  it("브라우저 설치창 거절은 나중에 횟수에 포함하지 않는다", async () => {
    usePlatform({ userAgent: ANDROID_CHROME });

    const { result } = renderHook(() => useInstallPrompt());
    fireBeforeInstallPrompt("dismissed");
    act(() => {
      vi.runAllTimers();
    });

    await act(async () => {
      await result.current.install();
    });

    expect(getInstallPreference().dismissCount).toBe(0);
    expect(result.current.open).toBe(false);
  });

  it("appinstalled를 받으면 기록하고 닫는다", () => {
    usePlatform({ userAgent: ANDROID_CHROME });

    const { result } = renderRevealed();

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
      vi.runAllTimers();
    });

    expect(getInstallPreference().installed).toBe(true);
    expect(result.current.open).toBe(false);
  });
});
