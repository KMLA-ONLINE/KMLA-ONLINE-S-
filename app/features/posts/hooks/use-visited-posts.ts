import { useCallback, useSyncExternalStore } from "react";

import {
  appendVisitedPost,
  readVisitedPosts,
  writeVisitedPosts,
} from "~/features/posts/model/visited-posts";

/**
 * 목록 보기에서 이미 열어본 게시물을 흐리게 그리기 위한 상태(기능 명세 §6.2).
 *
 * `usePostViewMode`와 같은 store 방식이다. `useSyncExternalStore`의 snapshot은 참조가
 * 안정되어야 하므로 — 매번 `JSON.parse`로 새 배열을 만들면 무한 루프가 된다 —
 * 모듈 수준에서 한 번만 읽어 캐시하고, 방문을 기록할 때만 새 Set으로 교체한다.
 */
const CHANGE_EVENT = "kmla-online:visited-posts-change";
const EMPTY: ReadonlySet<string> = new Set();

let snapshot: ReadonlySet<string> | null = null;

function getSnapshot(): ReadonlySet<string> {
  snapshot ??= new Set(readVisitedPosts());
  return snapshot;
}

/** prerender와 첫 hydration에서는 방문 기록이 없는 것으로 본다. */
function getServerSnapshot(): ReadonlySet<string> {
  return EMPTY;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function useVisitedPosts() {
  const visited = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const markVisited = useCallback((postId: string) => {
    const next = appendVisitedPost([...getSnapshot()], postId);
    writeVisitedPosts(next);
    snapshot = new Set(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { visited, markVisited };
}
