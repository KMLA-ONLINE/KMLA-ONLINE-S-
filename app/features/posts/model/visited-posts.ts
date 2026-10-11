// 계정이 바뀌면 버려야 하는 값이라 키 자체는 `user-scoped-storage`가 소유한다.
import { VISITED_POSTS_STORAGE_KEY } from "~/shared/lib/user-scoped-storage";

/** 무한정 쌓이면 파싱 비용이 커진다. 오래된 쪽부터 버린다. */
const MAX_VISITED = 500;

/** `localStorage`가 없거나 값이 깨지면 조용히 빈 상태다. 방문 표시는 부가 정보다. */
export function readVisitedPosts(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(VISITED_POSTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

/** 이미 있는 id는 뒤로 옮기지 않는다 — 재방문마다 순서를 흔들 이유가 없다. */
export function appendVisitedPost(current: string[], postId: string): string[] {
  if (current.includes(postId)) return current;
  return [...current, postId].slice(-MAX_VISITED);
}

export function writeVisitedPosts(postIds: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      VISITED_POSTS_STORAGE_KEY,
      JSON.stringify(postIds),
    );
  } catch {
    // 용량 초과. 다음 방문에 다시 시도한다.
  }
}
