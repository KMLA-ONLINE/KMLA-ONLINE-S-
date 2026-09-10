import { queryOptions } from "@tanstack/react-query";

import { getRecentUnreadNotificationCount } from "~/features/notifications/data/queries";

/**
 * 셸 뱃지는 라우트 로더가 아니라 이 쿼리가 소유한다.
 *
 * 예전에는 게이트 로더가 뱃지 수를 함께 읽었다. 그래서 뱃지 하나를 갱신하려면 게이트를
 * 재검증해야 했고, 게이트 재검증은 `shouldRevalidate`가 같은 URL을 통과시키는 탓에 지금
 * 보고 있는 라우트의 로더까지 같이 돌렸다 — 알림 하나에 그룹 게시물 20개를 다시 받는
 * 증폭이 여기서 나왔다. 뱃지를 키 하나로 떼어 내면 `invalidateQueries` 한 줄로 끝난다.
 *
 * `docs/DATA_CACHE_POLICY.md` §4가 "focus 복귀는 알림함과 셸 뱃지를 재검증한다"고 적은
 * 범위가 원래 이것이고, 라우트 전체 재검증은 그 범위를 넘긴 구현이었다.
 */
export const notificationKeys = {
  all: ["notifications"] as const,
  badge: () => [...notificationKeys.all, "badge"] as const,
};

/**
 * 뱃지는 사이드바와 탭바가 함께 읽어 observer가 둘이고, 메신저 셸과 일반 셸을 오갈 때마다
 * 다시 마운트된다. `staleTime`이 0이면 그 왕복마다 요청이 나가므로 1분을 둔다. 최신성은
 * 시간이 아니라 명시적 무효화(읽음 처리·Realtime·focus 복귀)가 책임진다 — 무효화는
 * `staleTime`과 무관하게 활성 observer를 곧바로 다시 읽힌다.
 */
export const NOTIFICATION_BADGE_STALE_TIME = 60_000;

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
