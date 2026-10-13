import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef } from "react";
import { useLocation, useRevalidator, useRouteLoaderData } from "react-router";

import {
  groupKeys,
  invalidateGroupContent,
  refreshGroupAccess,
} from "~/features/groups/data/cache";
import type { GroupDetail } from "~/features/groups/model/types";
import {
  notificationBadgeQuery,
  notificationKeys,
} from "~/features/notifications/data/cache";
import { subscribeToNotifications } from "~/features/notifications/data/subscriptions";
import { resyncWebPushSubscription } from "~/features/notifications/data/push";
import { setAppBadgeCount } from "~/shared/lib/app-badge";

const GROUP_ROUTE =
  /^\/groups\/(?!(?:create|discover|member-page|report-page)(?:\/|$))([^/]+)(?:\/|$)/;
const INBOX_REVALIDATION_DELAY_MS = 50;

/** 복귀 신호가 겹칠 때 뒤엣것을 버리는 간격. `focus`와 `visibilitychange`가 한 복귀에 둘 다 오기 때문이다. */
const RESUME_COALESCE_MS = 300;

/** 복귀 접근 확인 잠금을 붙들 수 있는 최대 시간. 응답 없는 연결이 이후 복귀 확인을 영영 막지 않게 한다. */
const GROUP_RESUME_TIMEOUT_MS = 10_000;

/** 게시물 목록을 그리지 않는 그룹 탭. 복귀 때 재검증해도 잃을 누적 페이지가 없다. */
const NON_POST_TABS = new Set(["members", "settings", "reports"]);

/**
 * 알림 Realtime과 창 focus 복귀를 받아 알림함과 셸 뱃지를 갱신한다 (`docs/DATA_CACHE_POLICY.md` §4).
 *
 * 신호는 뱃지 키만 무효화한다. 라우트 재검증은 대상을 고를 수 없어 그룹 상세·게시물까지 다시 받기 때문이다.
 * 알림함을 보고 있을 때, 그룹 복귀 확인에서 접근·권한 변경이 확인됐을 때, 게시물 목록이 없는 그룹 탭에서만 재검증한다.
 */
export function NotificationSync({ profileId }: { profileId: number }) {
  const queryClient = useQueryClient();
  const revalidator = useRevalidator();
  const location = useLocation();
  const groupData = useRouteLoaderData<{ group: GroupDetail }>(
    "routes/app/groups/detail",
  );
  const inboxRevalidationTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const groupResume = useRef<{ slug: string; viewerId: number } | null>(null);
  const mounted = useRef(true);

  const finishGroupResume = useEffectEvent(
    (slug: string, viewerId: number, changed: boolean) => {
      if (
        !mounted.current ||
        viewerId !== profileId ||
        GROUP_ROUTE.exec(location.pathname)?.[1] !== slug
      )
        return;
      const tab = new URLSearchParams(location.search).get("tab");
      if (changed) {
        void revalidator.revalidate();
      } else if (tab && NON_POST_TABS.has(tab) && groupData?.group) {
        // 멤버·신고·설정 탭은 지킬 누적 목록이 없다. 남이 바꾼 목록을 복귀 때 다시 읽는다.
        void invalidateGroupContent(
          queryClient,
          groupData.group.group_id,
          slug,
        ).then(() => revalidator.revalidate());
      }
    },
  );

  const resumeGroup = useEffectEvent(async (slug: string) => {
    const viewerId = profileId;
    if (
      groupResume.current?.slug === slug &&
      groupResume.current.viewerId === viewerId
    )
      return;
    const resume = { slug, viewerId };
    groupResume.current = resume;
    const release = () => {
      if (groupResume.current === resume) groupResume.current = null;
    };
    // 진행 중인 요청을 취소해야 다음 복귀의 `fetchQuery`가 멈춘 요청을 이어받지 않고 새로 묻는다.
    const timeout = setTimeout(() => {
      release();
      void queryClient.cancelQueries({
        queryKey: groupKeys.detail(slug),
        exact: true,
      });
    }, GROUP_RESUME_TIMEOUT_MS);
    let changed = false;
    try {
      changed = await refreshGroupAccess(queryClient, slug, groupData?.group);
    } catch {
      // 일시적인 조회 실패로 누적 목록을 버리지 않는다. 화면을 유지하고 다음 복귀가 다시 확인한다.
      return;
    } finally {
      clearTimeout(timeout);
      release();
    }
    finishGroupResume(slug, viewerId, changed);
  });

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

    const slug = GROUP_ROUTE.exec(location.pathname)?.[1];
    if (source === "focus" && slug) void resumeGroup(slug);
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
    mounted.current = true;
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
      mounted.current = false;
      groupResume.current = null;
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
