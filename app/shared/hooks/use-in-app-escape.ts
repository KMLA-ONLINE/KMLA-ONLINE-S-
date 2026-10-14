import { useEffect } from "react";

import { getInAppEscapeUrl } from "~/shared/lib/install-platform";

/** 넘긴 적이 있는지. 탭 단위로 남긴다. */
const AUTO_ESCAPE_KEY = "kmla-online:in-app-escape-tried";

function readTried(): boolean {
  try {
    return sessionStorage.getItem(AUTO_ESCAPE_KEY) === "1";
  } catch {
    return false;
  }
}

function recordTried(): void {
  try {
    sessionStorage.setItem(AUTO_ESCAPE_KEY, "1");
  } catch {
    // 남기지 못하면 새로고침할 때 한 번 더 넘길 뿐이다.
  }
}

/**
 * 인앱 브라우저로 들어온 사용자를 탭에서 처음 한 번 앱이나 브라우저로 넘긴다.
 *
 * 한 번만 시도하는 이유: `intent://`가 막히면 `S.browser_fallback_url`로 같은 페이지가 인앱
 * 브라우저에 다시 열린다. 기록 없이 매번 넘기면 그 자리에서 끝없이 튕긴다. 돌아오거나
 * 새로고침했을 때 다시 튕겨 내지 않는 것도 같은 기록이 막는다.
 */
export function useInAppEscape(): void {
  useEffect(() => {
    const url = getInAppEscapeUrl(window.location.href);
    if (!url || readTried()) return;
    recordTried();
    window.location.href = url;
  }, []);
}
