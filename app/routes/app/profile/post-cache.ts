import { removeFeedPost, resetFeed } from "~/features/feed";
import { getQueryClient } from "~/shared/lib/query-client";

/** 새 글·수정은 랭킹에 들어가야 하므로 세션을 새로 연다. */
export async function invalidateSavedProfilePost() {
  await resetFeed(getQueryClient());
}

/** 삭제는 랭킹을 다시 계산할 이유가 없다. 캐시에서 그 글만 덜어낸다. */
export function invalidateDeletedProfilePost(postId: string) {
  removeFeedPost(getQueryClient(), postId);
}
