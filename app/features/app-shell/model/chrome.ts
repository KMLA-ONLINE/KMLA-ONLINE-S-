export type ChromeMode = "none" | "sticky" | "hide-on-scroll";

export interface AppChromeConfig {
  header: ChromeMode;
  bottomNav: ChromeMode;
}

export interface AppChromeHandle {
  chrome: AppChromeConfig;
}

export const DEFAULT_APP_CHROME: AppChromeConfig = {
  header: "sticky",
  bottomNav: "none",
};

export function defineAppChrome(chrome: AppChromeConfig): AppChromeHandle {
  return { chrome };
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
    isChromeMode(chrome.bottomNav)
  );
}

function isChromeMode(value: unknown): value is ChromeMode {
  return value === "none" || value === "sticky" || value === "hide-on-scroll";
}
