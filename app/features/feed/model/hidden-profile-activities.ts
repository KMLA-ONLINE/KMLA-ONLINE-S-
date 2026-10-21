import type { FeedPost } from "~/features/feed/model/types";

/** 기기에 남기는 가린 게시물 ID 수. 넘치면 가장 오래전에 가린 것부터 다시 보인다. */
export const HIDDEN_PROFILE_ACTIVITY_LIMIT = 200;

const POST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 다른 사람의 프로필 사진·커버 변경 활동만 가릴 수 있다. */
export function canHideProfileActivity(post: FeedPost): boolean {
  return post.kind === "profile" && !post.is_author && !!post.activity_kind;
}

/** Only post IDs are stored on the device, most recently hidden first. */
function normalize(ids: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !POST_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length === HIDDEN_PROFILE_ACTIVITY_LIMIT) break;
  }
  return result;
}

/** 홈 피드에 그릴 게시물. 가린 목록에 남은 본인 활동은 가리지 않는다. */
export function visibleFeedPosts<T extends FeedPost>(
  posts: readonly T[],
  hiddenIds: ReadonlySet<string>,
): T[] {
  return posts.filter(
    (post) => !(canHideProfileActivity(post) && hiddenIds.has(post.post_id)),
  );
}

export function parseHiddenProfileActivities(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? normalize(value) : [];
  } catch {
    return [];
  }
}

export function hideProfileActivity(
  ids: readonly string[],
  postId: string,
): string[] {
  return normalize([postId, ...ids]);
}

export function unhideProfileActivity(
  ids: readonly string[],
  postId: string,
): string[] {
  return ids.filter((id) => id !== postId);
}
