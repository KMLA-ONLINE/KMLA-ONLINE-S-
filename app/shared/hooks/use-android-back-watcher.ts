import { useEffect } from "react";
import { useLocation } from "react-router";

interface CloseWatcherLike {
  addEventListener(type: "close", listener: () => void): void;
  destroy(): void;
}

type CloseWatcherConstructor = new () => CloseWatcherLike;

function isAndroid(): boolean {
  const { userAgentData } = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  if (userAgentData?.platform) return userAgentData.platform === "Android";
  return /Android/i.test(navigator.userAgent);
}

/** BrowserRouter가 entry마다 history state에 적는 위치. 세션의 첫 entry가 0이다. */
function historyIndex(): number {
  const state: unknown = window.history.state;
  if (typeof state !== "object" || state === null) return 0;
  const index = (state as Record<string, unknown>).idx;
  return typeof index === "number" ? index : 0;
}

/**
 * Android OS 뒤로가기를 `history.back()`으로 바꾼다.
 *
 * Chrome은 페이지가 사용자 조작 없이 쌓은 history entry를 OS 뒤로가기에서 건너뛴다. 알림이나 링크로
 * 처음 열 때 깔아 둔 부모 화면, 알림 클릭으로 router가 옮겨 간 직전 화면이 그렇다. 그대로 두면 OS
 * 뒤로가기가 그 화면들을 지나쳐 앱을 닫는다. `history.back()`은 이 규칙에 걸리지 않아 인앱 뒤로가기
 * 버튼은 멀쩡하다. 그래서 CloseWatcher로 OS 뒤로가기를 받아 같은 한 칸 뒤로 보낸다.
 *
 * 깔아 둔 화면은 history 맨 아래에 있어 언제 다시 지나갈지 모르므로, 밑에 entry가 있는 동안(`idx > 0`)
 * 늘 켜 둔다. 하는 일이 한 칸 뒤로뿐이라 보통 entry에서는 OS 뒤로가기와 결과가 같다. 맨 아래에서는
 * 꺼서 OS 뒤로가기가 앱을 닫게 둔다. watcher는 한 번 받으면 닫히므로 이동한 entry에서 다시 만든다 —
 * 사용자 조작 없이 만들 수 있는 watcher는 한 번에 하나라서, 하나씩 이어 만든다.
 *
 * iOS 스와이프는 CloseWatcher로 오지 않는다. 데스크톱에서는 Esc도 같은 요청으로 오므로 Android에서만 켠다.
 */
export function useAndroidBackWatcher() {
  const location = useLocation();

  useEffect(() => {
    if (!isAndroid()) return;
    const Watcher = (
      window as Window & { CloseWatcher?: CloseWatcherConstructor }
    ).CloseWatcher;
    if (!Watcher || historyIndex() <= 0) return;

    let watcher: CloseWatcherLike;
    try {
      watcher = new Watcher();
    } catch {
      // 조작 없이 만들 수 있는 몫을 넘으면 거부된다. 그때는 브라우저 기본 동작에 맡긴다.
      return;
    }
    watcher.addEventListener("close", () => window.history.back());
    return () => watcher.destroy();
  }, [location.key]);
}
