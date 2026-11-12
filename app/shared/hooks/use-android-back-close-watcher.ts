import { useEffect } from "react";
import { useLocation } from "react-router";

/**
 * 실험 3 (merge 금지): Android OS 뒤로가기를 CloseWatcher로 받아 `history.back()`으로 바꾼다.
 *
 * Chrome은 페이지가 사용자 조작 없이 쌓은 entry를 OS 뒤로가기에서 건너뛴다. 알림으로 열 때 깔아 둔
 * 부모 화면이 모두 건너뛰어져 앱이 닫힌다. `history.back()`은 이 규칙에 걸리지 않는다.
 *
 * 밑에 앱 entry가 있는 동안(`idx > 0`)만 켠다. 맨 아래에서는 꺼서 OS 뒤로가기가 앱을 닫게 둔다.
 * 받을 때마다 watcher가 닫히므로, 이동 뒤 새 entry에서 다시 만든다.
 *
 * 로그는 `[back-exp]`로 시작한다. chrome://inspect에서 본다.
 */

interface CloseWatcherLike {
  addEventListener(type: "close", listener: () => void): void;
  destroy(): void;
}

type CloseWatcherConstructor = new () => CloseWatcherLike;

const TAG = "[back-exp]";

function isAndroid(): boolean {
  const data = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  if (data?.platform) return data.platform === "Android";
  return /Android/i.test(navigator.userAgent);
}

function currentIndex(): number {
  const state: unknown = window.history.state;
  if (typeof state !== "object" || state === null) return 0;
  const index = (state as Record<string, unknown>).idx;
  return typeof index === "number" ? index : 0;
}

export function useAndroidBackCloseWatcher() {
  const location = useLocation();

  useEffect(() => {
    if (!isAndroid()) return;
    const Watcher = (
      window as Window & { CloseWatcher?: CloseWatcherConstructor }
    ).CloseWatcher;
    if (!Watcher) {
      console.info(TAG, "CloseWatcher unsupported");
      return;
    }
    const index = currentIndex();
    if (index <= 0) {
      console.info(TAG, "bottom entry, not armed", location.pathname);
      return;
    }

    let watcher: CloseWatcherLike;
    try {
      watcher = new Watcher();
    } catch (error) {
      console.info(TAG, "create failed", String(error));
      return;
    }
    console.info(TAG, "armed", { index, path: location.pathname });
    watcher.addEventListener("close", () => {
      console.info(TAG, "close → history.back()", { index });
      window.history.back();
    });
    return () => watcher.destroy();
  }, [location.key, location.pathname]);
}
