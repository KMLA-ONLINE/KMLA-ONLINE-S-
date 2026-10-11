import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { groupKeys } from "~/features/groups/data/cache";

import { getRecentUnreadNotificationCount } from "~/features/notifications/data/queries";

/**
 * 셸 뱃지는 라우트 로더가 아니라 이 쿼리가 소유한다. 로더가 들고 있으면 뱃지 갱신이 게이트와 현재 라우트 재검증을 끌고 돌았다.
 * `docs/DATA_CACHE_POLICY.md` §4의 "focus 복귀는 알림함과 셸 뱃지를 재검증한다"가 원래 범위다.
 */
export const notificationKeys = {
  all: ["notifications"] as const,
  badge: () => [...notificationKeys.all, "badge"] as const,
};

/**
 * observer가 둘이고 셸을 오갈 때마다 다시 마운트되므로 `staleTime`이 0이면 매번 요청이 나간다. 최신성은 명시적 무효화가 맡는다.
 */
const NOTIFICATION_BADGE_STALE_TIME = 60_000;

export function notificationBadgeQuery() {
  return queryOptions({
    queryKey: notificationKeys.badge(),
    queryFn: getRecentUnreadNotificationCount,
    staleTime: NOTIFICATION_BADGE_STALE_TIME,
    // 뱃지를 못 읽는다고 앱이 멈출 이유는 없다. 실패하면 0으로 그리고 다음 무효화에서
    // 다시 시도한다. 세션이 죽은 경우는 게이트의 `get_my_profile`이 이미 판정한다.
    retry: false,
  });
}

/**
 * 알림을 열었다. 목적지 RPC가 읽음 처리를 했으니 뱃지가 낡았고, 알림은 그룹 게시물 목록이 바뀌었다는 신호이기도 하다.
 * 그룹 목록은 2분 cache라, 그대로 두면 상세 밑에 깔리는 그룹 loader가 알림의 새 글이 없는 옛 목록을 쓴다.
 * 상세와 그룹을 오가는 이동은 재검증하지 않으므로 상세를 닫아도 그 목록이 남는다. 다시 읽는 것은 다음 loader에 맡긴다.
 */
export function invalidateOpenedNotification(
  queryClient: QueryClient,
): Promise<void> {
  // 뱃지는 화면에 observer가 있어 곧바로 다시 읽는다. 기다리면 그 요청만큼 이동이 늦어진다.
  void queryClient.invalidateQueries({ queryKey: notificationKeys.badge() });
  return queryClient.invalidateQueries({
    queryKey: groupKeys.postPageLists(),
    refetchType: "none",
  });
}
