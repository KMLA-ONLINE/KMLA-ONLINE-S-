import type { GroupDiscoveryCursor } from "~/features/groups/model/types";
import type { PostCursor } from "~/features/posts/model/types";
import { queryOptions, type QueryKey } from "@tanstack/react-query";

import { loadGroupHome } from "~/features/groups/data/queries";

/**
 * 두 값 모두 2분이다. 짧은 값은 모바일의 앱 왕복 복귀마다 재요청해 데이터 사용량이 컸다.
 * 내 변경은 mutation이 키를 무효화해 즉시 보이고(`docs/DATA_CACHE_POLICY.md` §4), 남의 변경은 당겨서 새로고침이 덮는다.
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
  /** 모든 그룹의 게시물 목록. 어느 그룹이 바뀌었는지 모를 때 한꺼번에 stale로 둔다. */
  postPageLists: () => [...groupKeys.all, "posts"] as const,
  postPages: (groupId: string) =>
    [...groupKeys.postPageLists(), groupId] as const,
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

/** 그룹 홈 목록. 로더가 캐시를 데우고 화면이 같은 옵션으로 구독한다. */
export function groupHomeQuery() {
  return queryOptions({
    queryKey: groupKeys.home(),
    queryFn: loadGroupHome,
    staleTime: GROUP_STALE_TIME,
  });
}

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
