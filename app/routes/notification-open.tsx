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
 * 앱이 이미 떠 있었다면 그것으로 끝이다 — 뒤로가기는 원래 보던 화면으로 돌아간다. 앱이 종료된
 * 상태에서 열렸다면 돌아갈 화면 자체가 없으므로, 목적지가 앱 안에서 놓여 있던 자리를 밑에
 * 깔고 그 위에 목적지를 얹는다. 그래야 뒤로가기가 "게시물이 닫히고 그룹 화면"이 된다.
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

    const needsBackStack = !fromNotificationInbox && !hasBackEntry();
    if (needsBackStack) seedBackStack(resolveBackStack(loaderData.target));

    void navigate(loaderData.target, { replace: !needsBackStack });
  }, [fromNotificationInbox, loaderData.target, navigate]);

  return null;
}
