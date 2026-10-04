import type { GroupDiscoveryCursor } from "~/features/groups/model/types";
import type { PostCursor } from "~/features/posts/model/types";
import type { QueryKey } from "@tanstack/react-query";

/**
 * 두 값 모두 2분이다. 30초·15초는 "탐색 이동 중 같은 화면을 두 번 읽지 않는다"만 노린
 * 값이었는데, 실제 모바일 사용은 다른 앱에 갔다 돌아오는 왕복이라 그 창을 언제나 넘긴다.
 * 복귀할 때마다 그룹 상세와 게시물 20개를 다시 받는 게 데이터 사용량의 큰 몫이었다.
 *
 * 늘려도 내 기기에서 한 변경은 즉시 보인다 — mutation이 해당 키를 명시적으로 무효화하기
 * 때문이다(`docs/DATA_CACHE_POLICY.md` §4). 늦게 보이는 건 다른 기기·다른 사람이 만든
 * 변경뿐이고, 그건 당겨서 새로고침이 덮는다.
 */
export const GROUP_STALE_TIME = 120_000;
export const GROUP_CONTENT_STALE_TIME = 120_000;

export const groupKeys = {
  all: ["groups"] as const,
  home: () => [...groupKeys.all, "home"] as const,
  discoveries: () => [...groupKeys.all, "discovery"] as const,
  discovery: (
    query: string,
    includeJoined: boolean,
    cursor: GroupDiscoveryCursor | null,
  ) => [...groupKeys.discoveries(), { query, includeJoined, cursor }] as const,
  details: () => [...groupKeys.all, "detail"] as const,
  detail: (slug: string) => [...groupKeys.details(), slug] as const,
  categories: (groupId: string) =>
    [...groupKeys.all, "categories", groupId] as const,
  postPages: (groupId: string) => [...groupKeys.all, "posts", groupId] as const,
  posts: (
    groupId: string,
    categoryId: string | null,
    cursor: PostCursor | null,
  ) => [...groupKeys.postPages(groupId), { categoryId, cursor }] as const,
  memberLists: (groupId: string) =>
    [...groupKeys.all, "members", groupId] as const,
  members: (groupId: string, query: string) =>
    [...groupKeys.memberLists(groupId), query] as const,
  joinRequests: (groupId: string) =>
    [...groupKeys.all, "join-requests", groupId] as const,
  invite: (groupId: string) => [...groupKeys.all, "invite", groupId] as const,
  reports: (groupId: string, sort: "count" | "recent") =>
    [...groupKeys.all, "reports", groupId, sort] as const,
};

export function isGroupAccessQuery(
  queryKey: QueryKey,
  groupId: string,
  slug: string,
) {
  return (
    queryKey[0] === groupKeys.all[0] &&
    (queryKey.includes(groupId) || queryKey.includes(slug))
  );
}
