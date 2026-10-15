import { Outlet, redirect } from "react-router";

import {
  AppShellProvider,
  appShellKeys,
  loadShellData,
  type ShellData,
} from "~/features/app-shell";
import type { Route } from "./+types/gate";
import { MessagingSync } from "~/features/messaging";
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
 * `Exclude<..., "accepted">`라서 상태가 늘면 컴파일이 깨진다.
 */
const GATE_REDIRECT = {
  draft: "/setup",
  pending: "/pending",
  blocked: "/blocked",
  withdrawn: "/login",
} as const;

/**
 * 로그인 화면으로 보낼 때 들어오려던 주소를 `next`로 넘긴다. 공유받은 게시물 링크로 들어왔다가
 * 로그인 화면을 한 번 거치면 그 글로 돌아갈 길이 없어진다. 받는 쪽(`getProfileDestination()`)이
 * 앱 안의 경로만 통과시킨다. 홈은 로그인 뒤 기본 목적지라 붙이지 않는다.
 */
function redirectToLogin(request: Request): Response {
  const url = new URL(request.url);
  const next = `${url.pathname}${url.search}`;
  return redirect(
    next === "/" ? "/login" : `/login?${new URLSearchParams({ next })}`,
  );
}

export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<ShellData> {
  // `staleTime: 0`으로 항상 새로 읽는다. Push 알림 경로에서 `resolve_my_notification_destination()`이
  // `read_at`을 찍은 직후 게이트가 마운트되므로, 캐시를 쓰면 읽은 알림이 최대 1분간 안 읽음으로 남는다.
  // 게이트 로더는 첫 진입에만 돌아 매번 읽어도 비싸지 않다.
  // 뱃지는 세션·프로필에 의존하지 않으므로 `loadShellData()`와 병렬로 띄운다(세션 없으면 401로 버려지고 /login으로 간다).
  const badge = getQueryClient()
    .fetchQuery({ ...notificationBadgeQuery(), staleTime: 0 })
    // 뱃지 하나 때문에 앱 전체가 에러 화면으로 갈 이유는 없다. 실패하면 0으로 그린다.
    .catch(() => 0);

  const shell = await loadShellData();

  if (!shell) {
    throw redirectToLogin(request);
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

  const data = { ...shell, profile: shell.profile };
  // 이후 갱신은 `refreshShellProfile()`이 이 쿼리로 한다. 게이트를 다시 돌리지 않는다.
  getQueryClient().setQueryData(appShellKeys.profile(), data);
  return data;
}

/**
 * 레이아웃 로더는 기본적으로 자식 라우트를 옮겨 다닐 때와 모든 mutation 뒤에 다시 돈다. 그대로 두면
 * 페이지를 넘기거나 댓글 하나를 달 때마다 RPC 3개가 나간다. 게이트는 첫 진입에만 돌린다.
 *
 * 셸 데이터를 바꾸는 action은 경로 목록이 아니라 쿼리로 갱신한다. 프로필·역할은
 * `refreshShellProfile()`, 뱃지는 `notificationKeys.badge()` 무효화다.
 */
export function shouldRevalidate() {
  return false;
}

export default function Shell({ loaderData }: Route.ComponentProps) {
  return (
    <AppShellProvider value={loaderData}>
      <Outlet />
      <NotificationSync profileId={loaderData.profile.id} />
      <NotificationPermissionPrompt profileId={loaderData.profile.id} />
      <MessagingSync profileId={loaderData.profile.id} />
    </AppShellProvider>
  );
}
