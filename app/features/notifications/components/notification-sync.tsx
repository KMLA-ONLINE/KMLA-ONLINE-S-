import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef } from "react";
import { useLocation, useRevalidator } from "react-router";

import { groupKeys } from "~/features/groups/data/cache";
import { notificationKeys } from "~/features/notifications/data/cache";
import { subscribeToNotifications } from "~/features/notifications/data/subscriptions";

const GROUP_ROUTE =
  /^\/groups\/(?!(?:create|discover|member-page|report-page)(?:\/|$))[^/]+(?:\/|$)/;
const INBOX_REVALIDATION_DELAY_MS = 50;

/**
 * 알림 Realtime과 창 focus 복귀를 받아 알림함과 셸 뱃지를 갱신한다
 * (`docs/DATA_CACHE_POLICY.md` §4).
 *
 * 예전에는 두 신호가 모두 `revalidator.revalidate()`를 불렀다. 그런데 라우트 재검증은
 * 대상을 고를 수 없다 — 게이트와 지금 보고 있는 라우트의 로더가 함께 돈다. 모바일에서
 * 창 focus는 앱을 전환해 돌아올 때마다, 키보드를 내릴 때마다 온다. 그래서 그룹 화면에
 * 있으면 복귀 한 번에 그룹 상세·카테고리·게시물 20개를 다시 받았고, 알림이 몰리면
 * 알림 한 건마다 같은 일이 반복됐다.
 *
 * 지금은 신호가 뱃지 키 하나만 무효화한다. 라우트를 재검증하는 건 알림함을 실제로 보고
 * 있을 때뿐이고, 그 화면의 목록은 로더가 소유하므로 그때는 재검증이 맞는 도구다. 예외는
 * focus 복귀 중인 그룹 화면이다. 다른 관리자가 그 사이 멤버십을 회수했을 수 있으므로 현재
 * 그룹 route만 다시 읽어 RLS 결과로 보호된 snapshot을 즉시 덮는다.
 */
export function NotificationSync({ profileId }: { profileId: number }) {
  const queryClient = useQueryClient();
  const revalidator = useRevalidator();
  const location = useLocation();
  const inboxRevalidationTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const scheduleInboxRevalidation = useEffectEvent(() => {
    if (inboxRevalidationTimer.current) {
      clearTimeout(inboxRevalidationTimer.current);
    }
    inboxRevalidationTimer.current = setTimeout(() => {
      inboxRevalidationTimer.current = null;
      void revalidator.revalidate();
    }, INBOX_REVALIDATION_DELAY_MS);
  });

  const sync = useEffectEvent((source: "notification" | "focus") => {
    void queryClient.invalidateQueries({ queryKey: notificationKeys.badge() });

    if (location.pathname === "/noti") {
      scheduleInboxRevalidation();
      return;
    }

    if (source === "focus" && GROUP_ROUTE.test(location.pathname)) {
      // loader의 fetchQuery가 2분 cache를 그대로 돌려주지 않도록 먼저 stale 처리한다.
      // observer가 아닌 route cache라 여기서 직접 refetch하지 않고 곧바로 route에 맡긴다.
      void queryClient.invalidateQueries({
        queryKey: groupKeys.all,
        refetchType: "none",
      });
      void revalidator.revalidate();
    }
  });

  useEffect(
    () => subscribeToNotifications(profileId, () => sync("notification")),
    [profileId],
  );

  useEffect(() => {
    const onFocus = () => sync("focus");
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (inboxRevalidationTimer.current) {
        clearTimeout(inboxRevalidationTimer.current);
      }
    };
  }, []);

  return null;
}
