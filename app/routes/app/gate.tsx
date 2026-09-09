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

  // 뱃지는 셸 데이터가 아니라 쿼리가 소유한다. 여기서는 캐시를 데우기만 하고 기다리지
  // 않는다 — 기다리면 이미 직렬인 콜드 스타트(세션 → 프로필 → 아바타 서명)에 왕복이 하나
  // 더 붙는다. `useNavBadges()`가 활성 observer라 이 요청을 그대로 이어받고, 같은 키의
  // 중복 요청은 TanStack이 합친다. `ensureQueryData`라서 캐시가 있으면 아무 요청도 없다.
  void getQueryClient()
    .ensureQueryData(notificationBadgeQuery())
    // 뱃지 하나 때문에 앱 전체가 에러 화면으로 갈 이유는 없다. 실패하면 0으로 그린다.
    .catch(() => 0);

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
  // 알림을 읽고 뱃지를 떨어뜨릴 때 이 경로로 들어온다.
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
