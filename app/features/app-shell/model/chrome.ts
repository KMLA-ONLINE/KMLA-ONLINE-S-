export type ChromeMode = "none" | "sticky" | "hide-on-scroll";
export type AppContentWidth = "2xl" | "3xl" | "4xl" | "5xl" | "full";
/**
 * `page`는 셸의 `ScrollRegion` 하나가 스크롤한다. `route`는 화면이 셸 높이를 꽉 채우고 패널마다
 * 스크롤을 직접 소유한다(메신저). `route`에서는 콘텐츠 폭, 당겨서 새로고침, 스크롤 복원이 쓰이지 않는다.
 */
export type AppScrollMode = "page" | "route";

export interface AppChromeConfig {
  header: ChromeMode;
  bottomNav: ChromeMode;
  contentWidth: AppContentWidth;
  pullToRefresh: boolean;
  /** 탭이나 링크로 다시 들어와도 마지막 스크롤 위치로 돌아간다. 뒤로 가기 복원은 모든 화면에 기본이다. */
  rememberScroll: boolean;
  scroll: AppScrollMode;
}

type OptionalChromeField =
  "contentWidth" | "pullToRefresh" | "rememberScroll" | "scroll";

type AppChromeDefinition = Omit<AppChromeConfig, OptionalChromeField> &
  Partial<Pick<AppChromeConfig, OptionalChromeField>>;

export interface AppChromeHandle {
  chrome: AppChromeConfig;
}

export const DEFAULT_APP_CHROME: AppChromeConfig = {
  header: "sticky",
  bottomNav: "none",
  contentWidth: "4xl",
  pullToRefresh: false,
  rememberScroll: false,
  scroll: "page",
};

export function defineAppChrome(chrome: AppChromeDefinition): AppChromeHandle {
  return {
    chrome: {
      ...chrome,
      contentWidth: chrome.contentWidth ?? DEFAULT_APP_CHROME.contentWidth,
      pullToRefresh: chrome.pullToRefresh ?? false,
      rememberScroll: chrome.rememberScroll ?? false,
      scroll: chrome.scroll ?? DEFAULT_APP_CHROME.scroll,
    },
  };
}

export function resolveAppChrome(
  matches: readonly { handle: unknown }[],
): AppChromeConfig {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const handle = matches[index].handle;
    if (isAppChromeHandle(handle)) return handle.chrome;
  }

  return DEFAULT_APP_CHROME;
}

function isAppChromeHandle(handle: unknown): handle is AppChromeHandle {
  if (!handle || typeof handle !== "object" || !("chrome" in handle)) {
    return false;
  }

  const chrome = handle.chrome;
  if (!chrome || typeof chrome !== "object") return false;

  return (
    "header" in chrome &&
    isChromeMode(chrome.header) &&
    "bottomNav" in chrome &&
    isChromeMode(chrome.bottomNav) &&
    "contentWidth" in chrome &&
    isContentWidth(chrome.contentWidth) &&
    "pullToRefresh" in chrome &&
    typeof chrome.pullToRefresh === "boolean" &&
    "rememberScroll" in chrome &&
    typeof chrome.rememberScroll === "boolean" &&
    "scroll" in chrome &&
    (chrome.scroll === "page" || chrome.scroll === "route")
  );
}

function isChromeMode(value: unknown): value is ChromeMode {
  return value === "none" || value === "sticky" || value === "hide-on-scroll";
}

function isContentWidth(value: unknown): value is AppContentWidth {
  return (
    value === "2xl" ||
    value === "3xl" ||
    value === "4xl" ||
    value === "5xl" ||
    value === "full"
  );
}
