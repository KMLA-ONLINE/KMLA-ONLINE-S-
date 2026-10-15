/**
 * 홈 화면 추가(A2HS) 유도에 필요한 플랫폼 판별.
 *
 * 전부 `window`/`navigator`/`localStorage`를 읽는다. `Layout`은 빌드 타임에 렌더되므로
 * 여기 있는 함수는 effect나 이벤트 핸들러 안에서만 불러야 한다.
 */

/**
 * 안내 모드.
 *
 * `install`만 브라우저가 실제 설치 프롬프트를 넘겨준 경우이고, 나머지는 우리가 손으로
 * 절차를 알려주는 수밖에 없는 경우다. 인앱 브라우저에는 안내를 띄우지 않으므로 모드가 없다.
 */
export type InstallMode =
  "install" | "ios-browser" | "ios-other" | "android-help" | "android-samsung";

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

export function isIOS(): boolean {
  // iPadOS 13+ Safari는 데스크톱 Mac UA를 보낸다. 터치 포인트 수로만 갈라낼 수 있다.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/**
 * 삼성 인터넷인가. 설치는 되지만 Web Push와 설치 앱 동작이 Chrome보다 불안정해서 설치 대신
 * Chrome으로 옮기라고 권한다.
 */
export function isSamsungInternet(): boolean {
  return /SamsungBrowser/i.test(navigator.userAgent);
}

/**
 * 지금 주소를 Android Chrome으로 여는 intent. Chrome이 없으면 Android가 Play 스토어로 보낸다.
 * `#Intent`가 fragment 자리를 쓰므로 원래 주소의 hash는 버린다.
 */
export function getChromeIntentUrl(href: string): string {
  const url = new URL(href);
  const scheme = url.protocol.replace(/:$/, "");
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${scheme};package=com.android.chrome;end`;
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
 * 어느 플랫폼이든 인앱 브라우저에는 홈 화면 추가·앱 설치 메뉴가 없다. 예전에는 다른
 * 브라우저로 옮기라는 안내를 띄웠지만, 링크를 잠깐 열어 본 사람에게 모달부터 들이미는 꼴이라
 * (특히 밖으로 나갈 길이 없는 iOS 페이스북) 설치 안내 자체를 띄우지 않는다.
 *
 * 판별은 두 갈래다. Android WebView는 UA에 `; wv)` 마커를 남기므로 앱 이름을 몰라도
 * 잡힌다 — 반대로 Chrome 커스텀 탭은 이 마커가 없고 실제로 설치도 되므로 걸리지 않는다.
 * iOS의 WKWebView에는 그런 마커가 없어서 앱 이름을 하나씩 나열하는 수밖에 없다.
 */
export function isInAppBrowser(): boolean {
  const ua = navigator.userAgent;

  return (
    /;\s*wv\)/i.test(ua) ||
    /NAVER|KAKAOTALK|DaumApps|Instagram|FBAN|FBAV|FB_IAB/i.test(ua) ||
    // 안내를 아예 숨기므로 다른 낱말 속 `line`에 걸리지 않게 LINE 앱 표식(`Line/13.x`)만 본다.
    /\bLine\//.test(ua)
  );
}

/** UA의 iOS 버전. iOS가 아니거나 읽을 수 없으면 `null`. */
function getIOSVersion(): { major: number; minor: number } | null {
  const version = /(?:CPU (?:iPhone )?OS|iPhone OS) (\d+)_(\d+)/i.exec(
    navigator.userAgent,
  );
  if (!version) return null;

  return { major: Number(version[1]), minor: Number(version[2]) };
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
  const version = getIOSVersion();
  if (!alternativeBrowser || !version) return false;

  return version.major > 16 || (version.major === 16 && version.minor >= 4);
}

/**
 * `beforeinstallprompt`가 오지 않는 브라우저에서 대신 보여줄 수동 안내 모드.
 * 폰·태블릿이 아니거나 인앱 브라우저면 `null`.
 */
export function getFallbackInstallMode(): InstallMode | null {
  if (isInAppBrowser()) return null;
  if (isIOS()) {
    return supportsIOSHomeScreenInstall() ? "ios-browser" : "ios-other";
  }
  if (isAndroid()) {
    return isSamsungInternet() ? "android-samsung" : "android-help";
  }

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
 *    설치되어 있으면 그 범위의 주소를 PWA가 받고, 아니면 기본 브라우저가 받는다. 막히면
 *    `S.browser_fallback_url`로 그 자리에 다시 열린다. 공식 기능이 아니다.
 *    `package`로 Chrome을 지정하지 않는 이유: 지정하면 PWA가 설치돼 있어도 Chrome 탭으로
 *    열린다. WebView 안에서는 설치 여부를 알 수 없어 둘 중 하나만 고를 수 있고, 설치된 PWA를
 *    앞세운다. 기본 브라우저가 삼성 인터넷이면 설치 안내가 Chrome으로 옮기라고 권한다.
 *  - iOS 17+ 의 페이스북·인스타그램은 `x-safari-https://`로 Safari에 넘긴다. 그보다 낮은
 *    iOS에는 밖으로 나갈 주소가 없어 `null`이고, 설치 안내도 띄우지 않으므로
 *    (`isInAppBrowser()`) 그 안에서 그대로 쓴다.
 *
 * iOS 카카오톡은 홈 화면 PWA가 아니라 Safari로 열린다 — iOS에는 링크로 PWA를 여는 길이 없다.
 */
export function getInAppEscapeUrl(href: string): string | null {
  const ua = navigator.userAgent;

  if (/KAKAOTALK/i.test(ua))
    return `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
  if (!/Instagram|FBAN|FBAV|FB_IAB/i.test(ua)) return null;

  if (isIOS()) {
    const version = getIOSVersion();
    return version && version.major >= 17 ? `x-safari-${href}` : null;
  }
  if (!isAndroid()) return null;

  // `#Intent`가 fragment 자리를 쓰므로 원래 주소의 hash는 버린다. 앱 라우팅은 hash를 쓰지 않는다.
  const url = new URL(href);
  const scheme = url.protocol.replace(/:$/, "");
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${scheme};S.browser_fallback_url=${encodeURIComponent(href)};end`;
}
