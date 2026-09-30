import { useCallback, useSyncExternalStore } from "react";

import type { PostViewMode } from "~/features/posts/model/types";
import {
  readPostViewMode,
  writePostViewMode,
} from "~/features/posts/model/view-preference";

/**
 * 카드/목록 선택은 기기 취향이라 `localStorage`에 산다. 여러 곳이 동시에 읽으므로 store 하나를 `useSyncExternalStore`로 구독하고,
 * 같은 탭의 `setItem`은 `storage` 이벤트가 없어 직접 알린다.
 */
const CHANGE_EVENT = "kmla-online:posts-view-change";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  // 다른 탭에서 바꾼 경우까지 따라간다.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * prerender와 첫 hydration에서는 항상 `"card"`다. `localStorage`를 render 중에 읽으면
 * `root.tsx`의 build-time render가 깨진다(AGENTS.md).
 */
function getServerSnapshot(): PostViewMode {
  return "card";
}

export function usePostViewMode(): [
  PostViewMode,
  (mode: PostViewMode) => void,
] {
  const mode = useSyncExternalStore(
    subscribe,
    readPostViewMode,
    getServerSnapshot,
  );

  const setMode = useCallback((next: PostViewMode) => {
    writePostViewMode(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [mode, setMode];
}
