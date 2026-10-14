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

/**
 * 홈 피드 오버레이의 상세에서 수정 화면으로 갈 때 심는 표식. 저장하면 그룹·타임라인의 상세가
 * 아니라 들어온 피드 오버레이로 되돌아간다. 피드는 route가 아니라 search param 오버레이라
 * 수정 화면이 스스로는 어디서 왔는지 알 수 없다.
 */
export const FROM_FEED: { fromFeed: true } = { fromFeed: true };

export function isFromFeed(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    "fromFeed" in state &&
    state.fromFeed === true
  );
}

/**
 * 피드에서 보낸 삭제 요청이 어디서 왔는가. 삭제 action은 원래 그룹·타임라인으로 보내지만
 * 피드에서 지웠으면 피드에 남는다.
 *
 *  - `overlay`: 피드 위의 상세 창. 지운 글의 오버레이 entry를 `/`로 갈아치운다.
 *  - `card`: 피드 카드의 메뉴. 이미 `/`에 있으므로 이동하지 않는다 — 같은 경로로 다시
 *    이동하면 스크롤 위치가 흔들린다. 카드는 `removeFeedPost`가 캐시에서 덜어낸다.
 */
export type FeedDeleteOrigin = "overlay" | "card";

const FEED_DELETE_FIELD = "from";
const FEED_DELETE_PREFIX = "feed-";

/** 삭제 폼에 더할 값. 피드 밖에서 지우면 아무것도 더하지 않는다. */
export function feedDeleteFields(
  origin: FeedDeleteOrigin | null,
): Record<string, string> {
  return origin
    ? { [FEED_DELETE_FIELD]: `${FEED_DELETE_PREFIX}${origin}` }
    : {};
}

export function readFeedDeleteOrigin(
  formData: FormData,
): FeedDeleteOrigin | null {
  const value = formData.get(FEED_DELETE_FIELD);
  if (value === `${FEED_DELETE_PREFIX}overlay`) return "overlay";
  if (value === `${FEED_DELETE_PREFIX}card`) return "card";
  return null;
}

/** 그룹 게시물 상세 주소. 수정 화면은 여기에 `/edit`, 댓글 시트는 `?view=comments`를 붙인다. */
export function groupPostPath(slug: string, postId: string): string {
  return `/groups/${slug}/posts/${postId}`;
}
