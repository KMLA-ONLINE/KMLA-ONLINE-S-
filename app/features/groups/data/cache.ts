import type {
  GroupDetail,
  GroupDiscoveryCursor,
  GroupNewPostCounts,
} from "~/features/groups/model/types";
import {
  queryOptions,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { markGroupPostsVisited } from "~/features/groups/data/mutations";
import {
  loadGroupDetail,
  loadGroupHome,
  loadGroupNewPostCounts,
} from "~/features/groups/data/queries";

/**
 * 두 값 모두 2분이다. 짧은 값은 모바일의 앱 왕복 복귀마다 재요청해 데이터 사용량이 컸다.
 * 내 변경은 mutation이 키를 무효화해 즉시 보이고(`docs/DATA_CACHE_POLICY.md` §4), 남의 변경은 당겨서 새로고침이 덮는다.
 */
export const GROUP_STALE_TIME = 120_000;
export const GROUP_CONTENT_STALE_TIME = 120_000;
/**
 * 새 게시물 수는 남이 글을 쓰면 바뀌는데 그건 내 mutation이 알려 주지 않는다. RPC 하나라 들어올 때와
 * 앱으로 돌아올 때마다 다시 읽는다. 0이 아닌 것은 로더가 데운 값을 마운트가 곧바로 또 읽지 않게 하려는 것이다.
 */
const GROUP_NEW_POST_COUNTS_STALE_TIME = 10_000;

export const groupKeys = {
  all: ["groups"] as const,
  home: () => [...groupKeys.all, "home"] as const,
  /** 그룹 홈 아래에 두어 홈을 무효화하면 함께 stale이 된다. */
  newPostCounts: () => [...groupKeys.home(), "new-post-counts"] as const,
  /** 이 세션에서 방문으로 보낸 마지막 기준. 서버에 묻지 않고 캐시 정리를 따라 계정이 바뀌면 사라진다. */
  postsSeenUntil: (groupId: string) =>
    [...groupKeys.all, "posts-seen-until", groupId] as const,
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
  /** 카테고리마다 하나인 무한 목록들. 고정·검색 키와 데이터 모양이 달라 따로 묶는다. */
  postLists: (groupId: string) =>
    [...groupKeys.postPages(groupId), "list"] as const,
  posts: (groupId: string, categoryId: string | null) =>
    [...groupKeys.postLists(groupId), { categoryId }] as const,
  /** 고정 게시물. 목록 키 아래 두어 삭제·카테고리 변경의 무효화가 함께 닿는다. */
  pinnedPosts: (groupId: string) =>
    [...groupKeys.postPages(groupId), "pinned"] as const,
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

/** 그룹 홈 새 게시물 수(§7.19). 목록과 달리 앱 복귀(focus·visibility)에도 다시 읽는다. */
export function groupNewPostCountsQuery() {
  return queryOptions({
    queryKey: groupKeys.newPostCounts(),
    queryFn: loadGroupNewPostCounts,
    staleTime: GROUP_NEW_POST_COUNTS_STALE_TIME,
    refetchOnWindowFocus: true,
  });
}

/** 그룹 홈 목록. 로더가 캐시를 데우고 화면이 같은 옵션으로 구독한다. */
export function groupHomeQuery() {
  return queryOptions({
    queryKey: groupKeys.home(),
    queryFn: loadGroupHome,
    staleTime: GROUP_STALE_TIME,
  });
}

/** 그룹의 보호된 캐시인지. slug는 상세 키 자리에서만 맞춘다 — `posts`·`home` 같은 slug가 다른 키의 고정 구간과 겹친다. */
export function isGroupAccessQuery(
  queryKey: QueryKey,
  groupId: string,
  slug: string,
) {
  return (
    queryKey[0] === groupKeys.all[0] &&
    (queryKey.includes(groupId) ||
      (queryKey[1] === groupKeys.details()[1] && queryKey[2] === slug))
  );
}

/** 그룹 상세를 뺀 보호된 캐시를 stale로 둔다. 구독 중인 화면이 떨어져 나가지 않도록 지우지 않고, 다음 loader가 다시 읽는다. */
export function invalidateGroupContent(
  queryClient: QueryClient,
  groupId: string,
  slug: string,
) {
  return queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryKey[1] !== groupKeys.details()[1] &&
      isGroupAccessQuery(query.queryKey, groupId, slug),
    refetchType: "none",
  });
}

/**
 * 복귀는 접근 상태만 확인한다. 변화가 없으면 오래된 게시물 캐시도 건드리지 않는다.
 * 조회 실패(오프라인·타임아웃·5xx)는 변경으로 보지 않고 그대로 던진다 — 캐시를 비우면 권한이 같은데도
 * 피드가 첫 페이지로 돌아간다. 데이터 보호는 RLS가 하고, 다음 복귀가 다시 확인한다.
 */
export async function refreshGroupAccess(
  queryClient: QueryClient,
  slug: string,
  previous: GroupDetail | undefined,
): Promise<boolean> {
  // 비교 기준은 표시 중인 loader snapshot이다. inactive 상세 cache는 화면을 보는 중에도 GC된다.
  const current = await queryClient.fetchQuery({
    queryKey: groupKeys.detail(slug),
    queryFn: () => loadGroupDetail(slug),
    staleTime: 0,
    retry: false,
  });
  // 이름·아이콘·인원 같은 표시 필드는 비교하지 않는다. 그것 때문에 재검증하면 누적 페이지를 잃는다 —
  // 당겨서 새로고침이 덮는다.
  const fields = [
    "group_id",
    "membership_state",
    "member_role",
    "kind",
    "join_policy",
    "identity_policy",
    "posting_policy",
    "hide_staff_roles",
  ] as const satisfies readonly (keyof GroupDetail)[];
  const changed =
    !previous ||
    !current ||
    fields.some((field) => previous[field] !== current[field]);
  if (changed) {
    await Promise.all([
      previous && invalidateGroupContent(queryClient, previous.group_id, slug),
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

/**
 * 그룹 게시물 목록 캐시로 새 글을 보여 줄 수 없으면 stale로 두어 이번 로더가 새로 받게 한다(§7.19).
 * 새 글 수가 이 그룹에 새 글이 있다고 하거나, 새 글 수가 없거나 목록보다 먼저 읽혀 목록 뒤에 올라온 글을
 * 알려 주지 못하는 때다. 한 로더에서 한 번만 부른다 — 새로 받은 목록은 새 글 수보다 늦어 또 뒤처져 보인다.
 * 새 글은 어느 카테고리에도 들 수 있으므로 카테고리 목록도 함께 stale로 둔다.
 */
export function refreshStaleGroupPosts(
  queryClient: QueryClient,
  groupId: string,
) {
  const cache = queryClient.getQueryCache();
  const posts = cache.find({
    queryKey: groupKeys.posts(groupId, null),
    exact: true,
  });
  if (!posts?.state.data) return;
  const counts = queryClient.getQueryState<GroupNewPostCounts>(
    groupKeys.newPostCounts(),
  );
  if (
    !counts?.data ||
    counts.dataUpdatedAt < posts.state.dataUpdatedAt ||
    counts.data[groupId]
  ) {
    for (const list of cache.findAll({
      queryKey: groupKeys.postLists(groupId),
    }))
      list.invalidate();
  }
}

/**
 * 보여 준 그룹 게시물 목록까지 방문을 기록한다(§7.19). 새 글 수는 RPC를 기다리지 않고 먼저 0으로 낮춘다.
 * 그룹 홈에는 활성 observer가 없어, 그러지 않으면 RPC보다 먼저 돌아온 목록에 옛 숫자가 남는다.
 * 기록이 끝나면 성패와 관계없이 서버 값을 다시 읽는다. 실패하면 0이 거짓말이고, 성공해도 보여 준 글보다
 * 늦게 올라온 글은 새 글로 남는다. 같은 목록을 다시 그리는 재검증은 기준이 그대로라 보내지 않는다.
 */
export function markGroupPostsSeen(
  queryClient: QueryClient,
  groupId: string,
  posts: readonly { published_at: string }[],
) {
  const seenUntil = newestPublishedAt(posts);
  if (!seenUntil) return;
  const sentKey = groupKeys.postsSeenUntil(groupId);
  const sent = queryClient.getQueryData<string>(sentKey);
  if (sent && sent >= seenUntil) return;

  queryClient.setQueryData(sentKey, seenUntil);
  queryClient.setQueryData(
    groupKeys.newPostCounts(),
    (counts: GroupNewPostCounts | undefined) =>
      counts && { ...counts, [groupId]: 0 },
  );
  void markGroupPostsVisited(groupId, seenUntil)
    .catch(() => queryClient.removeQueries({ queryKey: sentKey, exact: true }))
    .then(() =>
      queryClient.invalidateQueries({ queryKey: groupKeys.newPostCounts() }),
    );
}

/**
 * 문자열 그대로 비교한다. PostgREST는 시각을 UTC 고정 형식으로 주고, `Date`로 바꾸면 마이크로초가
 * 잘려 기준이 그 글보다 앞서므로 그 글이 계속 새 글로 남는다.
 */
function newestPublishedAt(posts: readonly { published_at: string }[]) {
  let newest: string | null = null;
  for (const post of posts) {
    if (!newest || post.published_at > newest) newest = post.published_at;
  }
  return newest;
}
