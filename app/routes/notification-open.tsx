import { useEffect, useRef } from "react";
import { replace, useNavigate } from "react-router";

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
 * 목적지 밑에 무엇을 깔지는 **돌아갈 내역이 있는가** 하나로 갈린다. 앱이 종료된 상태에서
 * 열렸다면 뒤로 갈 곳 자체가 없으므로, 목적지가 앱 안에서 놓여 있던 자리를 루트까지 깐다.
 * 앱이 이미 떠 있었다면 사용자가 보던 화면이 밑에 있으니 아무것도 깔지 않는다.
 *
 * 알림을 한 번 눌렀으면 entry도 하나다. 게시물이 그룹 위에 얹히는 오버레이라는 이유로 그룹을
 * 한 칸 끼워 넣던 시절이 있었는데, 가본 적 없는 화면을 뒤로가기가 내놓는 데다 알림을 연달아
 * 확인할 때마다 뒤로가기가 한 번씩 더 들었다. 게시물에서 그룹으로 가는 길은 상세 머리의 그룹
 * 링크가 대신 맡는다 — 뒤로가기에 숨겨 두는 것보다 보이는 편이 낫다.
 *
 * 깔았다면 목적지는 그 위에 push한다. 깔 것이 없을 때만 자기 entry를 목적지로 갈아치운다.
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

    void navigate(loaderData.target, { replace: stack.length === 0 });
  }, [loaderData.target, navigate]);

  return null;
}
