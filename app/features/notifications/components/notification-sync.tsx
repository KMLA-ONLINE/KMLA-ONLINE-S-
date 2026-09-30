import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef } from "react";
import { useLocation, useRevalidator } from "react-router";

import { groupKeys } from "~/features/groups/data/cache";
import {
  notificationBadgeQuery,
  notificationKeys,
} from "~/features/notifications/data/cache";
import { subscribeToNotifications } from "~/features/notifications/data/subscriptions";
import { resyncWebPushSubscription } from "~/features/notifications/data/push";
import { setAppBadgeCount } from "~/shared/lib/app-badge";

const GROUP_ROUTE =
  /^\/groups\/(?!(?:create|discover|member-page|report-page)(?:\/|$))[^/]+(?:\/|$)/;
const INBOX_REVALIDATION_DELAY_MS = 50;

/** 복귀 신호가 겹칠 때 뒤엣것을 버리는 간격. `focus`와 `visibilitychange`가 한 복귀에 둘 다 오기 때문이다. */
const RESUME_COALESCE_MS = 300;

/**
 * 알림 Realtime과 창 focus 복귀를 받아 알림함과 셸 뱃지를 갱신한다 (`docs/DATA_CACHE_POLICY.md` §4).
 *
 * 신호는 뱃지 키만 무효화한다. 라우트 재검증은 대상을 고를 수 없어 그룹 상세·게시물까지 다시 받기 때문이다.
 * 알림함을 보고 있을 때(목록을 로더가 소유)와 focus 복귀 중인 그룹 화면(멤버십 회수 반영)만 예외다.
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

  /**
   * 복귀 신호를 `focus`에만 걸지 않는다. 설치형 PWA는 되살릴 때 `focus`가 안 오기도 한다(특히 iOS).
   * 한 복귀에 둘 다 오면 짧은 간격 안의 두 번째와, 창이 안 보이는 동안의 신호는 버린다.
   */
  useEffect(() => {
    let lastResumeAt = 0;

    const onResume = () => {
      if (document.visibilityState !== "visible") return;

      const now = Date.now();
      if (now - lastResumeAt < RESUME_COALESCE_MS) return;
      lastResumeAt = now;
      sync("focus");
    };

    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
      if (inboxRevalidationTimer.current) {
        clearTimeout(inboxRevalidationTimer.current);
      }
    };
  }, []);

  useAppBadgeSync();
  usePushSubscriptionResync(profileId);

  return null;
}

/**
 * 홈 화면 아이콘 숫자를 셸 뱃지와 같은 서버 값으로 맞춘다. 서비스 워커(`public/push-sw.js`)의 값은 근사치라 앱이 뜬 뒤엔 여기가 덮는다.
 * 게이트 로더가 채운 키(`staleTime` 1분)를 읽으므로 요청은 늘지 않는다.
 */
function useAppBadgeSync(): void {
  const { data: unreadCount } = useQuery(notificationBadgeQuery());

  useEffect(() => {
    // 아직 못 읽었으면 0으로 지우지 않는다. 로딩 중에 뱃지가 사라졌다 돌아오면 그게 더
    // 눈에 띈다.
    if (unreadCount === undefined) return;
    setAppBadgeCount(unreadCount);
  }, [unreadCount]);
}

/**
 * 브라우저의 Push 구독이 서버에도 있는지 앱이 뜰 때 한 번 확인한다. 서비스 워커는 새 endpoint를 올릴 세션이 없어 그 등록이 여기서 끝난다.
 * 없는 구독은 새로 만들지 않는다. 앱에서 끈 알림이 저절로 켜지기 때문이다.
 */
function usePushSubscriptionResync(profileId: number): void {
  useEffect(() => {
    void resyncWebPushSubscription();
  }, [profileId]);
}
