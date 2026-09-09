import {
  Outlet,
  redirect,
  type ShouldRevalidateFunctionArgs,
} from "react-router";

import {
  AppShellProvider,
  loadShellData,
  type ShellData,
} from "~/features/app-shell";
import type { Route } from "./+types/gate";
import { notificationBadgeQuery } from "~/features/notifications";
import { NotificationPermissionPrompt } from "~/features/notifications/components/notification-permission-prompt";
import { NotificationSync } from "~/features/notifications/components/notification-sync";
import { getQueryClient } from "~/shared/lib/query-client";

/**
 * 로그인한 사용자가 보는 모든 화면의 바깥 껍데기.
 *
 * 여기가 하는 일은 둘뿐이다.
 *  1. 인증/승인 게이트 — 앱 전체에서 이 한 곳
 *  2. 셸 데이터(프로필 + 내비 뱃지) 적재
 *
 * 실제 화면 chrome은 아래의 일반 앱/메신저 레이아웃이 각각 소유한다.
 */

/**
 * 승인 상태별 목적지. RLS 정책이 전부 accepted 사용자만 통과시키게 될 것이므로, accepted가
 * 아닌 사용자는 에러가 아니라 "빈 결과"를 보게 된다. 세션 유무만 보고 통과시키면 아무것도 없는
 * 앱을 헤매게 되니 status로 갈라야 한다.
 *
 * `Exclude<..., "accepted">`라서 상태가 하나 늘면 여기서 컴파일이 깨진다 — 새 상태를 조용히
 * 통과시키는 일이 없다.
 */
const GATE_REDIRECT = {
  draft: "/setup",
  pending: "/pending",
  blocked: "/blocked",
  withdrawn: "/login",
} as const;

export async function clientLoader(): Promise<ShellData> {
  // 뱃지는 셸 데이터가 아니라 쿼리가 소유하지만, 읽는 시점은 여전히 여기다.
  //
  // `staleTime`을 0으로 덮어 항상 새로 읽는다. 게이트 로더가 도는 순간이 곧 뱃지가 틀렸을
  // 수 있는 순간이기 때문이다 — 특히 Push 알림으로 들어오는 경로에서 그렇다.
  // `resolve_my_notification_destination()`이 `read_at`을 찍고, 그 라우트는 게이트 밖에
  // 있어 목적지로 넘어오며 게이트가 새로 마운트된다. 캐시된 값을 그대로 쓰면 방금 읽은
  // 알림이 최대 1분 동안 안 읽음으로 남는다. 같은 이유로 Realtime 이벤트를 언마운트 구간에
  // 놓쳤을 때도 여기서 복구된다.
  //
  // 매번 읽어도 비싸지 않다. 게이트 로더는 이제 창 focus마다 돌지 않고, 첫 진입·뮤테이션·
  // 당겨서 새로고침·알림함 복귀에서만 돈다 — 예전에 focus마다 이 RPC를 보내던 것보다 적다.
  //
  // `loadShellData()`와 병렬로 띄운다. 순서를 지키면 세션 → 프로필 → 아바타 서명이 끝난
  // 뒤에야 요청이 나가 왕복이 하나 더 붙는데, 뱃지는 그중 무엇에도 의존하지 않는다.
  // 세션이 없으면 이 요청은 401로 버려지지만, 그 경로는 곧바로 /login으로 나간다.
  const badge = getQueryClient()
    .fetchQuery({ ...notificationBadgeQuery(), staleTime: 0 })
    // 뱃지 하나 때문에 앱 전체가 에러 화면으로 갈 이유는 없다. 실패하면 0으로 그린다.
    .catch(() => 0);

  const shell = await loadShellData();

  if (!shell) {
    throw redirect("/login");
  }

  if (!shell.profile) {
    throw redirect("/setup");
  }

  if (shell.profile.status !== "accepted") {
    throw redirect(GATE_REDIRECT[shell.profile.status]);
  }

  // 여기서 기다려야 첫 페인트부터 숫자가 맞다. 위에서 병렬로 띄웠으므로 셸 데이터보다
  // 먼저 끝나 있는 것이 보통이고, 그때는 기다리는 시간이 0이다.
  await badge;

  return { ...shell, profile: shell.profile };
}

/**
 * 레이아웃 로더는 기본적으로 자식 라우트를 옮겨 다닐 때마다 다시 돈다. 그대로 두면 페이지를
 * 넘길 때마다 RPC 3개가 나간다. 값이 실제로 바뀔 수 있는 순간에만 다시 돌린다.
 *
 * (`Route.ShouldRevalidateFunctionArgs`는 typegen이 만들어 주지 않는다 — 이 타입만
 * react-router에서 직접 가져온다.)
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
}: ShouldRevalidateFunctionArgs) {
  // 뮤테이션 뒤에는 프로필·뱃지가 바뀔 수 있다.
  if (formMethod && formMethod !== "GET") return true;

  // 명시적 revalidate(`useRevalidator().revalidate()`)는 URL이 그대로다.
  // 알림 Realtime·focus 복귀에서 현재 알림함을 다시 읽을 때 이 경로로 들어온다.
  if (
    currentUrl.pathname === nextUrl.pathname &&
    currentUrl.search === nextUrl.search
  ) {
    return true;
  }

  // 단순 페이지 이동이면 다시 부르지 않는다.
  return false;
}

export default function Shell({ loaderData }: Route.ComponentProps) {
  return (
    <AppShellProvider value={loaderData}>
      <Outlet />
      <NotificationSync profileId={loaderData.profile.id} />
      <NotificationPermissionPrompt
        key={loaderData.profile.id}
        profileId={loaderData.profile.id}
      />
    </AppShellProvider>
  );
}
