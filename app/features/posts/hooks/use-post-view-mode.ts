import { useCallback, useSyncExternalStore } from "react";

import type { PostViewMode } from "~/features/posts/model/types";
import {
  readPostViewMode,
  writePostViewMode,
} from "~/features/posts/model/view-preference";

/**
 * 카드/목록 선택은 기기 단위 취향이라 서버가 아니라 `localStorage`에 산다. 문제는 같은 값을
 * 두 곳(그룹 헤더 ⋯ 메뉴, 게시물 패널)이 동시에 읽는다는 것 — `useState`로 각자 들고 있으면
 * 한쪽에서 바꿔도 다른 쪽은 다음 mount까지 옛 값을 그린다.
 *
 * 그래서 store를 하나 두고 `useSyncExternalStore`로 구독한다. 같은 탭에서의 `setItem`은 native
 * `storage` 이벤트를 발생시키지 않으므로 직접 만든 이벤트로 알린다.
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
