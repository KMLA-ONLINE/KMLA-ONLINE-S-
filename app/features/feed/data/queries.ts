import { mockFeedPosts } from "~/features/feed/mock";
import type { FeedPost } from "~/features/feed/model/types";

const PAGE_SIZE = 10;

/**
 * 피드 한 페이지. Supabase 호출은 이 파일에서만 한다.
 *
 * ─── 지금은 mock이다 ───────────────────────────────────────────────────────────
 * `list_feed_posts()` RPC가 아직 없다. 생기면 `~/features/feed/mock`을 지우고 본문을 이걸로 바꾼다:
 *
 * ```ts
 * const { data, error } = await getSupabase().rpc("list_feed_posts", {
 *   p_before_id: beforeId,
 *   p_limit: PAGE_SIZE,
 * });
 * if (error) throw error;
 * return data ?? [];
 * ```
 *
 * 인자 이름(`p_before_id`)은 생성된 타입이 검증한다 — `getSupabase()`가 `SupabaseClient<Database>`라
 * 오타 난 RPC 이름·인자가 컴파일에서 걸린다.
 */
export function listFeedPosts(beforeId?: number): Promise<FeedPost[]> {
  const page = beforeId
    ? mockFeedPosts.filter((post) => post.post_id < beforeId)
    : mockFeedPosts;

  return Promise.resolve(page.slice(0, PAGE_SIZE));
}
