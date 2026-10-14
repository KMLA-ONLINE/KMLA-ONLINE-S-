import { useEffect, useRef } from "react";
import { replace, useNavigate } from "react-router";

// 배럴(`~/features/app-shell`)은 셸 컴포넌트를 전부 끌고 온다. 미리 읽기 하나만 필요하다.
import {
  discardPrefetchedShellData,
  prefetchShellData,
} from "~/features/app-shell/data/queries";
import {
  invalidateOpenedNotification,
  resolveNotificationDestination,
  sanitizeNotificationDestination,
} from "~/features/notifications";
import { getQueryClient } from "~/shared/lib/query-client";
import type { Route } from "./+types/notification-open";
import {
  ABOVE_SEEDED_PARENT_STATE,
  declaresParent,
  hasBackEntry,
  resolveBackStack,
  seedBackStack,
} from "~/shared/lib/back-stack";

/**
 * Push 알림 클릭의 착지점.
 *
 * 이 route는 history에 남지 않는다. 남으면 뒤로가기가 이 loader를 다시 돌려 목적지로 되돌려
 * 보내므로, 사용자가 알림으로 들어온 화면에서 빠져나갈 수 없다. 인증된 목적지는 route가 먼저
 * history에 확정된 뒤 컴포넌트가 자기 entry를 갈아치운다. loader에서 즉시 replace하면 SPA
 * navigation 중에는 출발 화면의 entry가 아직 현재 위치라 알림함 자체를 덮어쓰게 된다.
 *
 * 목적지 밑에 무엇을 깔지는 **돌아갈 내역이 있는가** 하나로 갈린다. 앱이 종료된 상태에서
 * 열렸다면 뒤로 갈 곳 자체가 없으므로, 목적지가 앱 안에서 놓여 있던 자리를 루트까지 깐다.
 * 앱이 이미 떠 있었다면 사용자가 보던 화면이 밑에 있으니 아무것도 깔지 않는다.
 *
 * 알림을 한 번 눌렀으면 entry도 하나다. 그룹을 중간에 끼워 넣으면 가본 적 없는 화면이 뒤로가기에
 * 나오고 entry가 쌓이므로 끼우지 않는다. 그룹으로 가는 길은 상세 머리의 그룹 링크가 맡는다.
 *
 * 깔았다면 목적지는 그 위에 push한다. 깔 것이 없을 때만 자기 entry를 목적지로 갈아치운다.
 *
 * 목적지는 인증 게이트 아래에 있다. 게이트의 셸 데이터(세션·프로필)는 목적지와 무관하므로 목적지 RPC와
 * 함께 미리 띄워, 게이트가 그 결과를 넘겨받게 한다. 뱃지는 목적지 RPC가 `read_at`을 찍은 뒤에 읽어야
 * 하므로 미리 띄우지 않는다.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const notificationId = params.notificationId;
  if (!notificationId) throw replace("/noti");

  prefetchShellData();
  try {
    const destination = await resolveNotificationDestination(notificationId);
    if (destination === null) {
      const next = `/noti/open/${encodeURIComponent(notificationId)}`;
      throw replace(`/login?${new URLSearchParams({ next })}`);
    }

    const target = sanitizeNotificationDestination(destination);
    await invalidateOpenedNotification(getQueryClient());
    return { target };
  } catch (thrown) {
    // 로그인 이동이든 실패든 게이트로 가지 않는다. 미리 읽은 값을 남기면 다음 게이트 재검증이 낡은 값을 받는다.
    discardPrefetchedShellData();
    throw thrown;
  }
}

/** 목적지 밑에 깔 화면들. 이 창이 알림으로 처음 열렸을 때만 있다. */
function resolveSeedStack(target: string): string[] {
  return hasBackEntry() ? [] : resolveBackStack(target);
}

export default function NotificationOpenRoute({
  loaderData,
}: Route.ComponentProps) {
  const navigate = useNavigate();
  const startedNavigation = useRef(false);

  useEffect(() => {
    if (startedNavigation.current) return;
    startedNavigation.current = true;

    const stack = resolveSeedStack(loaderData.target);
    if (stack.length > 0) seedBackStack(stack);

    if (stack.length === 0) {
      void navigate(loaderData.target, { replace: true });
      return;
    }
    // 표에 없는 목적지 밑에는 홈만 깔렸으므로 직속 부모가 밑에 있다고 표시하지 않는다.
    void navigate(loaderData.target, {
      state: declaresParent(loaderData.target)
        ? ABOVE_SEEDED_PARENT_STATE
        : undefined,
    });
  }, [loaderData.target, navigate]);

  return null;
}
