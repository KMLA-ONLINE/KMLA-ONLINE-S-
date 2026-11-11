import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { groupKeys } from "~/features/groups/data/cache";

import { markPostOpened } from "~/features/notifications/data/mutations";
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
 * 그룹 홈의 새 게시물 수도 같은 신호로 낡았다.
 */
export function invalidateOpenedNotification(
  queryClient: QueryClient,
): Promise<void> {
  // 뱃지는 화면에 observer가 있어 곧바로 다시 읽는다. 기다리면 그 요청만큼 이동이 늦어진다.
  void queryClient.invalidateQueries({ queryKey: notificationKeys.badge() });
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: groupKeys.postPageLists(),
      refetchType: "none",
    }),
    // RPC 하나라 그룹 홈이 떠 있으면 바로 다시 읽는다.
    queryClient.invalidateQueries({ queryKey: groupKeys.newPostCounts() }),
  ]).then(() => undefined);
}

/**
 * 게시물 상세를 열었다. 그 글을 그룹 새 게시물 수에서 빼고 내게 온 그 글의 알림을 읽음 처리한다(§7.19, §14.1).
 * 게시물 상세를 띄우는 loader는 모두 이것을 부르고 기다리지 않는다. 빠진 경로로 읽은 글은 새 글과 안 읽은 알림으로 남는다.
 * 열 때마다 보낸다. 열어 둔 동안 집계로 다시 안 읽음이 된 알림은 다음에 열 때 읽기 때문이다.
 *
 * 새 게시물 수: 재조회가 이 기록 뒤의 값을 이미 받았으면 직접 뺀 수가 하나 더 내려가므로 서버 값을 다시 읽는다.
 * 상세는 그룹 홈을 구독하지 않아 비활성 쿼리까지 읽는다. 값 없는 첫 조회는 취소하면 기다리는 로더가 실패하므로
 * 두고, 기록 전 값이면 다음 재조회가 바로잡는다.
 * 뱃지: Realtime UPDATE도 다시 읽게 하지만 연결이 끊겼을 수 있어 직접 무효화한다. 알림함은 열 때마다 새로 읽는다.
 * 실패하면 요청은 반영됐는데 응답만 잃었을 수 있어 둘 다 다시 읽는다.
 */
export function recordPostOpened(queryClient: QueryClient, postId: string) {
  void markPostOpened(postId)
    .then(({ countedAsNew, notificationsRead }) =>
      Promise.all([
        countedAsNew &&
          queryClient.invalidateQueries({
            queryKey: groupKeys.newPostCounts(),
            refetchType: "all",
          }),
        notificationsRead > 0 &&
          queryClient.invalidateQueries({
            queryKey: notificationKeys.badge(),
          }),
      ]),
    )
    .catch(() =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: groupKeys.newPostCounts() }),
        queryClient.invalidateQueries({ queryKey: notificationKeys.badge() }),
      ]),
    );
}
