const STORAGE_KEY = "kmla-online:visited-posts:v1";

/**
 * 무한정 쌓이면 목록 하나 그리자고 수 MB짜리 JSON을 파싱하게 된다. 오래된 쪽부터 버린다 —
 * "이미 읽음" 표시는 최근 것만 맞아도 쓸모가 있다.
 */
const MAX_VISITED = 500;

/**
 * `localStorage`가 없거나(비공개 모드, 용량 초과) 값이 깨졌을 때는 조용히 빈 상태로 떨어진다.
 * 방문 표시는 부가 정보라서, 이것 때문에 게시물 목록이 통째로 죽으면 안 된다.
 */
export function readVisitedPosts(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(postIds));
  } catch {
    // 용량 초과. 다음 방문에 다시 시도한다.
  }
}
