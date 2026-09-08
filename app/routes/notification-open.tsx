import { useEffect, useRef } from "react";
import { replace, useLocation, useNavigate } from "react-router";

import {
  resolveNotificationDestination,
  sanitizeNotificationDestination,
} from "~/features/notifications";
import type { Route } from "./+types/notification-open";
import {
  hasBackEntry,
  resolveBackStack,
  resolveOverlayParent,
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
 * 목적지 밑에 무엇을 깔지는 두 갈래다. 앱이 종료된 상태에서 열렸다면 돌아갈 화면 자체가
 * 없으므로, 목적지가 앱 안에서 놓여 있던 자리를 루트까지 전부 깐다. 앱이 이미 떠 있었다면 원래
 * 보던 화면이 밑에 있으니 그대로 두되, 목적지가 오버레이일 때만 부모를 한 칸 끼워 넣는다 —
 * 오버레이의 닫기는 바로 밑 entry를 드러내는 일이라, 그러지 않으면 알림함에서 연 게시물을
 * 닫았을 때 글이 놓여 있던 그룹이 아니라 알림함으로 튕긴다.
 *
 * 어느 쪽이든 깔았다면 목적지는 그 위에 push한다. 깔 것이 없을 때만 자기 entry를 목적지로
 * 갈아치운다.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const notificationId = params.notificationId;
  if (!notificationId) throw replace("/noti");

  const destination = await resolveNotificationDestination(notificationId);
  if (destination === null) {
    const next = `/noti/open/${encodeURIComponent(notificationId)}`;
    throw replace(`/login?${new URLSearchParams({ next })}`);
  }

  const target = sanitizeNotificationDestination(destination);
  return { target };
}

/** 목적지 밑에 깔 화면들. 이 창이 알림으로 처음 열렸으면 전부, 아니면 오버레이의 부모 한 칸. */
function resolveSeedStack(
  target: string,
  fromNotificationInbox: boolean,
): string[] {
  if (!fromNotificationInbox && !hasBackEntry())
    return resolveBackStack(target);

  const parent = resolveOverlayParent(target);
  return parent === null ? [] : [parent];
}

export default function NotificationOpenRoute({
  loaderData,
}: Route.ComponentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const startedNavigation = useRef(false);
  const navigationState: unknown = location.state;
  const fromNotificationInbox =
    typeof navigationState === "object" &&
    navigationState !== null &&
    "fromNotificationInbox" in navigationState &&
    navigationState.fromNotificationInbox === true;

  useEffect(() => {
    if (startedNavigation.current) return;
    startedNavigation.current = true;

    const stack = resolveSeedStack(loaderData.target, fromNotificationInbox);
    if (stack.length > 0) seedBackStack(stack);

    void navigate(loaderData.target, { replace: stack.length === 0 });
  }, [fromNotificationInbox, loaderData.target, navigate]);

  return null;
}
