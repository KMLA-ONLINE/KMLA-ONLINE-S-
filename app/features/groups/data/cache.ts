import type {
  GroupDetail,
  GroupDiscoveryCursor,
} from "~/features/groups/model/types";
import type { PostCursor } from "~/features/posts/model/types";
import {
  queryOptions,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { loadGroupDetail, loadGroupHome } from "~/features/groups/data/queries";

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
  /** 게시물 검색 결과. 돌아왔을 때 첫 화면을 그리는 데만 쓰고 매번 다시 읽는다. */
  postSearch: (groupId: string, query: string) =>
    [...groupKeys.postPages(groupId), "search", query] as const,
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

/** 복귀는 접근 상태만 확인한다. 변화가 없으면 오래된 게시물 캐시도 건드리지 않는다. */
export async function refreshGroupAccess(
  queryClient: QueryClient,
  slug: string,
  previous: GroupDetail | undefined,
): Promise<boolean> {
  // 비교 기준은 표시 중인 loader snapshot이다. inactive 상세 cache는 화면을 보는 중에도 GC된다.
  const clearContent = () => {
    if (previous)
      queryClient.removeQueries({
        predicate: (query) =>
          query.queryKey[1] !== "detail" &&
          isGroupAccessQuery(query.queryKey, previous.group_id, slug),
      });
  };
  let current: GroupDetail | null;
  try {
    current = await queryClient.fetchQuery({
      queryKey: groupKeys.detail(slug),
      queryFn: () => loadGroupDetail(slug),
      staleTime: 0,
      retry: false,
    });
  } catch (error) {
    // route 재시도에서 권한 변경이 확인돼도 오래된 권한 표시를 가진 게시물 cache를 재사용하지 않는다.
    clearContent();
    throw error;
  }
  const fields = [
    "group_id",
    "membership_state",
    "member_role",
    "kind",
    "join_policy",
    "identity_policy",
    "posting_policy",
    "hide_staff_roles",
  ] as const;
  const changed =
    !previous ||
    !current ||
    fields.some((field) => previous[field] !== current[field]);
  if (changed) {
    clearContent();
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: groupKeys.home(),
        refetchType: "none",
      }),
      queryClient.invalidateQueries({
        queryKey: groupKeys.discoveries(),
        refetchType: "none",
      }),
    ]);
  }
  return changed;
}
