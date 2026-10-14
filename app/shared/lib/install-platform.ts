/**
 * 홈 화면 추가(A2HS) 유도에 필요한 플랫폼 판별.
 *
 * 전부 `window`/`navigator`/`localStorage`를 읽는다. `Layout`은 빌드 타임에 렌더되므로
 * 여기 있는 함수는 effect나 이벤트 핸들러 안에서만 불러야 한다.
 */

/**
 * 안내 모드 4분기.
 *
 * `install`만 브라우저가 실제 설치 프롬프트를 넘겨준 경우이고, 나머지 셋은 우리가 손으로
 * 절차를 알려주는 수밖에 없는 경우다.
 */
export type InstallMode =
  "install" | "ios-browser" | "ios-other" | "android-help" | "android-other";

export const INSTALL_PREFERENCE_KEY = "kmla-online:pwa-install-preference";

export interface InstallPreference {
  dismissCount: number;
  installed: boolean;
  neverShow: boolean;
}

const DEFAULT_PREFERENCE: InstallPreference = {
  dismissCount: 0,
  installed: false,
  neverShow: false,
};

let memoryPreference = DEFAULT_PREFERENCE;

export function getInstallPreference(): InstallPreference {
  try {
    const raw = localStorage.getItem(INSTALL_PREFERENCE_KEY);
    if (!raw) {
      memoryPreference = DEFAULT_PREFERENCE;
      return memoryPreference;
    }

    const stored = JSON.parse(raw) as Partial<InstallPreference>;

    memoryPreference = { ...DEFAULT_PREFERENCE, ...stored };
    return memoryPreference;
  } catch {
    return memoryPreference;
  }
}

function saveInstallPreference(preference: InstallPreference): void {
  memoryPreference = preference;
  try {
    localStorage.setItem(INSTALL_PREFERENCE_KEY, JSON.stringify(preference));
  } catch {
    // The prompt can still behave correctly for this page without persistence.
  }
}

export function recordInstallAvailable(): void {
  saveInstallPreference({
    ...getInstallPreference(),
    installed: false,
  });
}

export function recordInstalled(): void {
  saveInstallPreference({
    ...getInstallPreference(),
    installed: true,
  });
}

export function recordInstallDismissal(): InstallPreference {
  const current = getInstallPreference();
  const preference = {
    ...current,
    dismissCount: current.dismissCount + 1,
  };
  saveInstallPreference(preference);
  return preference;
}

export function neverShowInstallPrompt(): void {
  saveInstallPreference({
    ...getInstallPreference(),
    neverShow: true,
  });
}

/** 이미 설치된 창에서 실행 중인가. manifest의 `display_override`와 같은 순서로 본다. */
export function isStandalone(): boolean {
  // iOS Safari는 display-mode 미디어 쿼리 대신 이 비표준 플래그로만 알려준다.
  const nav = navigator as Navigator & { standalone?: boolean };

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    nav.standalone === true
  );
}

function isIOS(): boolean {
  // iPadOS 13+ Safari는 데스크톱 Mac UA를 보낸다. 터치 포인트 수로만 갈라낼 수 있다.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/**
 * 설치 유도를 띄울 기기인가 — 폰과 태블릿만이고 데스크톱은 제외한다.
 *
 * 데스크톱 Chrome도 `beforeinstallprompt`를 발생시키기 때문에, 이벤트만 믿으면 노트북에서도
 * 다이얼로그가 뜬다. UA로 한 번 거르고, DevTools 기기 에뮬레이션까지 걸리지 않도록 실제
 * 거친 포인터(터치)가 있는지 한 번 더 본다.
 */
export function isHandheld(): boolean {
  if (!isIOS() && !isAndroid()) return false;

  return window.matchMedia("(any-pointer: coarse)").matches;
}

/**
 * 다른 앱이 자기 안에 띄운 브라우저인가.
 *
 * 어느 플랫폼이든 인앱 브라우저에는 홈 화면 추가·앱 설치 메뉴가 없다. 그런데도 "메뉴에서
 * 앱 설치를 고르세요"라고 안내하면 존재하지 않는 메뉴를 찾게 만든다. 국내에서는 카카오톡
 * 링크로 들어오는 비중이 커서 이 갈래가 드물지 않다.
 *
 * 판별은 두 갈래다. Android WebView는 UA에 `; wv)` 마커를 남기므로 앱 이름을 몰라도
 * 잡힌다 — 반대로 Chrome 커스텀 탭은 이 마커가 없고 실제로 설치도 되므로 걸리지 않는다.
 * iOS의 WKWebView에는 그런 마커가 없어서 앱 이름을 하나씩 나열하는 수밖에 없다.
 */
function isInAppBrowser(): boolean {
  const ua = navigator.userAgent;

  return (
    /;\s*wv\)/i.test(ua) ||
    /NAVER|KAKAOTALK|DaumApps|Instagram|FBAN|FBAV|Line/i.test(ua)
  );
}

/**
 * iOS에서 '홈 화면에 추가'가 실제로 가능한 브라우저인지.
 *
 * iOS의 모든 브라우저는 WebKit이라 UA에 `Safari`가 남지만, 홈 화면 추가 메뉴는 진짜
 * Safari와 iOS 16.4+ 의 대체 브라우저에만 있다.
 */
function supportsIOSHomeScreenInstall(): boolean {
  const ua = navigator.userAgent;

  if (isInAppBrowser()) return false;

  // Safari has supported Add to Home Screen since before iOS 16.4.
  if (/Version\/.*Safari\//i.test(ua)) return true;

  const alternativeBrowser = /CriOS|FxiOS|EdgiOS|Orion/i.test(ua);
  const version = /(?:CPU (?:iPhone )?OS|iPhone OS) (\d+)_(\d+)/i.exec(ua);
  if (!alternativeBrowser || !version) return false;

  const major = Number(version[1]);
  const minor = Number(version[2]);
  return major > 16 || (major === 16 && minor >= 4);
}

/**
 * `beforeinstallprompt`가 오지 않는 브라우저에서 대신 보여줄 수동 안내 모드.
 * 폰·태블릿이 아니면 `null`.
 */
export function getFallbackInstallMode(): InstallMode | null {
  if (isIOS()) {
    return supportsIOSHomeScreenInstall() ? "ios-browser" : "ios-other";
  }
  if (isAndroid()) return isInAppBrowser() ? "android-other" : "android-help";

  return null;
}

/**
 * 인앱 브라우저에서 빠져나갈 방법.
 *
 * 인앱 브라우저는 로그인과 저장소가 따로라서 링크를 눌러 들어오면 늘 로그아웃된 화면이다.
 * 웹에는 "앱 밖에서 열어라"는 표준이 없어 앱과 OS마다 길이 다르다.
 *
 *  - 카카오톡은 자체 주소(`kakaotalk://web/openExternal`)로 기본 브라우저를 연다. 공식 기능이다.
 *  - 페이스북·인스타그램의 Android WebView는 `intent://`로 Android에 주소를 넘긴다. PWA가
 *    설치되어 있으면 그 범위의 주소를 PWA가 받고, 아니면 `S.browser_fallback_url`로 그 자리에
 *    다시 열린다. 공식 기능이 아니라 막는 버전도 있다.
 *  - iOS의 페이스북·인스타그램에는 밖으로 나갈 주소가 없어 `null`이다. 이때는 설치 안내의
 *    `ios-other` 모드가 Safari로 옮기라고 안내한다.
 *
 * iOS 카카오톡은 홈 화면 PWA가 아니라 Safari로 열린다 — iOS에는 링크로 PWA를 여는 길이 없다.
 */
export function getInAppEscapeUrl(href: string): string | null {
  const ua = navigator.userAgent;

  if (/KAKAOTALK/i.test(ua))
    return `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
  if (!/Instagram|FBAN|FBAV|FB_IAB/i.test(ua) || !isAndroid()) return null;

  // `#Intent`가 fragment 자리를 쓰므로 원래 주소의 hash는 버린다. 앱 라우팅은 hash를 쓰지 않는다.
  const url = new URL(href);
  const scheme = url.protocol.replace(/:$/, "");
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${scheme};S.browser_fallback_url=${encodeURIComponent(href)};end`;
}
