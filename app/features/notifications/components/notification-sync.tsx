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

/**
 * 복귀 신호가 겹칠 때 뒤엣것을 버리는 간격.
 *
 * `focus`와 `visibilitychange`는 같은 복귀에서 둘 다 오는 게 보통이다. 그대로 두면 복귀
 * 한 번에 그룹 라우트를 두 번 재검증한다.
 */
const RESUME_COALESCE_MS = 300;

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

  /**
   * 복귀 신호를 `focus` 하나에만 걸어 두지 않는다.
   *
   * 설치형 PWA를 배경에서 되살릴 때 `focus`가 오지 않는 경우가 있다(특히 iOS). 그러면
   * 알림을 눌러 앱으로 돌아왔는데도 뱃지가 이전 값 그대로 남는다. 이 코드베이스의 다른
   * 복귀 처리(`use-service-worker.ts`, `korea-date.ts`)도 `visibilitychange`를 본다.
   *
   * 두 이벤트가 같은 복귀에서 함께 오는 쪽이 보통이므로 짧은 간격 안의 두 번째는 버린다.
   * 창이 보이지 않는 동안 온 신호도 버린다 — 배경에서 재검증해 봐야 화면에 쓸 데가 없다.
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
 * 홈 화면 아이콘 위의 숫자를 셸 뱃지와 같은 값으로 맞춘다.
 *
 * 이 값의 주인은 서버가 세는 안 읽은 수다. 서비스 워커도 앱이 떠 있지 않은 동안 뱃지를
 * 건드리지만(`public/push-sw.js`) 그쪽은 화면에 남은 카드 수라 근사치이고, 앱이 뜬 뒤로는
 * 여기가 덮는다.
 *
 * 쿼리를 하나 더 구독하지만 요청이 늘지는 않는다. 게이트 로더가 이미 채워 둔 키이고
 * `staleTime`이 1분이라, 여기서는 캐시된 값을 읽고 이후 무효화에 함께 따라간다.
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
 * 브라우저가 들고 있는 Push 구독이 서버에도 있는지 앱이 뜰 때 한 번 확인한다.
 *
 * Push service는 구독을 말없이 갈아치운다. 서비스 워커가 `pushsubscriptionchange`에서
 * 다시 구독하지만 새 endpoint를 서버에 올릴 로그인 세션이 없어서, 그 등록은 여기서
 * 끝난다. 이게 없으면 사용자에게는 알림 설정이 "켜짐"인 채로 알림만 조용히 끊긴다.
 *
 * 없는 구독을 새로 만들지는 않는다. 앱에서 알림을 끄면 권한은 granted로 남은 채 구독만
 * 해지되는데, 그 상태에서 새로 구독하면 사용자가 끈 알림이 저절로 켜진다.
 */
function usePushSubscriptionResync(profileId: number): void {
  useEffect(() => {
    void resyncWebPushSubscription();
  }, [profileId]);
}
