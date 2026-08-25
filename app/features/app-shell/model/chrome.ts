export type ChromeMode = "none" | "sticky" | "hide-on-scroll";
export type AppContentWidth = "2xl" | "3xl" | "4xl" | "5xl" | "full";

export interface AppChromeConfig {
  header: ChromeMode;
  bottomNav: ChromeMode;
  contentWidth: AppContentWidth;
  pullToRefresh: boolean;
}

type AppChromeDefinition = Omit<
  AppChromeConfig,
  "contentWidth" | "pullToRefresh"
> &
  Partial<Pick<AppChromeConfig, "contentWidth" | "pullToRefresh">>;

export interface AppChromeHandle {
  chrome: AppChromeConfig;
}

export const DEFAULT_APP_CHROME: AppChromeConfig = {
  header: "sticky",
  bottomNav: "none",
  contentWidth: "4xl",
  pullToRefresh: false,
};

export function defineAppChrome(chrome: AppChromeDefinition): AppChromeHandle {
  return {
    chrome: {
      ...chrome,
      contentWidth: chrome.contentWidth ?? DEFAULT_APP_CHROME.contentWidth,
      pullToRefresh: chrome.pullToRefresh ?? false,
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
    typeof chrome.pullToRefresh === "boolean"
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
