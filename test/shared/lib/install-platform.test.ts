import { afterEach, describe, expect, it } from "vitest";

import {
  getChromeIntentUrl,
  getInAppEscapeUrl,
} from "~/shared/lib/install-platform";

const ANDROID_WEBVIEW =
  "Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36";
const IPHONE_WEBVIEW =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const IPHONE_WEBVIEW_16 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

const HREF = "https://kmla.example/group/1/post/2?tab=a#c3";

function useUserAgent(userAgent: string) {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "userAgent");
});

describe("getInAppEscapeUrl", () => {
  it("opens KakaoTalk links outside through KakaoTalk's own scheme", () => {
    const kakao = `kakaotalk://web/openExternal?url=${encodeURIComponent(HREF)}`;

    useUserAgent(`${ANDROID_WEBVIEW} KAKAOTALK 10.5.0`);
    expect(getInAppEscapeUrl(HREF)).toBe(kakao);

    useUserAgent(`${IPHONE_WEBVIEW} KAKAOTALK 10.5.0`);
    expect(getInAppEscapeUrl(HREF)).toBe(kakao);
  });

  it("hands Facebook and Instagram on Android to the OS with a fallback", () => {
    const intent = `intent://kmla.example/group/1/post/2?tab=a#Intent;scheme=https;S.browser_fallback_url=${encodeURIComponent(HREF)};end`;

    useUserAgent(`${ANDROID_WEBVIEW} Instagram 300.0.0.0 Android`);
    expect(getInAppEscapeUrl(HREF)).toBe(intent);

    useUserAgent(`${ANDROID_WEBVIEW} [FB_IAB/FB4A;FBAV/470.0.0.0;]`);
    expect(getInAppEscapeUrl(HREF)).toBe(intent);
  });

  it("opens Facebook and Instagram on iOS 17+ in Safari", () => {
    const safari = `x-safari-${HREF}`;

    useUserAgent(`${IPHONE_WEBVIEW} [FBAN/FBIOS;FBAV/470.0.0.0]`);
    expect(getInAppEscapeUrl(HREF)).toBe(safari);

    useUserAgent(`${IPHONE_WEBVIEW} Instagram 300.0.0.0`);
    expect(getInAppEscapeUrl(HREF)).toBe(safari);
  });

  it("has no way out of Facebook and Instagram before iOS 17", () => {
    useUserAgent(`${IPHONE_WEBVIEW_16} [FBAN/FBIOS;FBAV/470.0.0.0]`);
    expect(getInAppEscapeUrl(HREF)).toBeNull();
  });

  it("leaves ordinary browsers and other in-app browsers alone", () => {
    useUserAgent(ANDROID_CHROME);
    expect(getInAppEscapeUrl(HREF)).toBeNull();

    useUserAgent(`${ANDROID_WEBVIEW} NAVER(inapp; search; 2000; 12.0.0)`);
    expect(getInAppEscapeUrl(HREF)).toBeNull();
  });
});

describe("getChromeIntentUrl", () => {
  it("opens the current address in Android Chrome, dropping the hash", () => {
    expect(getChromeIntentUrl(HREF)).toBe(
      "intent://kmla.example/group/1/post/2?tab=a#Intent;scheme=https;package=com.android.chrome;end",
    );
  });
});
