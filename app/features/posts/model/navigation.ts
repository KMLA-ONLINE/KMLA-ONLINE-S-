/**
 * 그룹 화면 안에서 상세로 갈 때 심는 표식. 상세의 그룹 링크를 감추는 데만 쓴다 — 뒤로가기가 이미 그룹을 내놓는다.
 * 이전 history entry를 알 방법이 없고(Safari에 `navigation.entries()` 없음), 표식을 빠뜨렸을 때 링크가 한 번 더 보이는 쪽이 안전해 그룹 쪽에 심는다.
 */
export const FROM_GROUP: { fromGroup: true } = { fromGroup: true };

/** `location.state`는 무엇이든 들어올 수 있으므로 좁혀서 읽는다. */
export function isFromGroup(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    "fromGroup" in state &&
    state.fromGroup === true
  );
}

/** 그룹 게시물 상세 주소. 수정 화면은 여기에 `/edit`, 댓글 시트는 `?view=comments`를 붙인다. */
export function groupPostPath(slug: string, postId: string): string {
  return `/groups/${slug}/posts/${postId}`;
}
