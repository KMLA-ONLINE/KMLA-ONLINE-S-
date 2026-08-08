import {
  Outlet,
  redirect,
  type ShouldRevalidateFunctionArgs,
} from "react-router";

import { AppHeader } from "~/domains/shell/components/app-header";
import { AppSidebar } from "~/domains/shell/components/app-sidebar";
import { loadShellData } from "~/domains/shell/data/queries";
import type { ProfileStatus, ShellData } from "~/domains/shell/model/types";

/**
 * 로그인한 사용자가 보는 모든 화면의 바깥 껍데기.
 *
 * 여기가 하는 일은 셋뿐이다.
 *  1. 인증/승인 게이트 — 앱 전체에서 이 한 곳
 *  2. 셸 데이터(프로필 + 내비 뱃지) 적재
 *  3. 데스크톱 크롬(헤더 + 사이드바) 프레임
 *
 * 어떤 화면이 어떤 레이아웃을 쓰는지는 `routes.ts`가 정한다. 이 파일은 모른다.
 */

/**
 * 승인 상태별 목적지. RLS 정책이 전부 accepted 사용자만 통과시키게 될 것이므로, accepted가
 * 아닌 사용자는 에러가 아니라 "빈 결과"를 보게 된다. 세션 유무만 보고 통과시키면 아무것도 없는
 * 앱을 헤매게 되니 status로 갈라야 한다.
 *
 * `Exclude<..., "accepted">`라서 상태가 하나 늘면 여기서 컴파일이 깨진다 — 새 상태를 조용히
 * 통과시키는 일이 없다.
 */
const GATE_REDIRECT: Record<Exclude<ProfileStatus, "accepted">, string> = {
  none: "/setup",
  rejected: "/setup",
  pending: "/pending",
  withdrawn: "/login",
};

export async function clientLoader(): Promise<ShellData> {
  const shell = await loadShellData();

  if (!shell) {
    throw redirect("/login");
  }

  if (shell.profile.status !== "accepted") {
    throw redirect(GATE_REDIRECT[shell.profile.status]);
  }

  return shell;
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

export default function Shell() {
  return (
    // h-dvh: 모바일 브라우저의 주소창 접힘까지 따라간다(svh/vh와 달리 실제 보이는 높이).
    // overflow-hidden: 스크롤 주체는 아래 레이아웃의 <main>이지 body가 아니다.
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* 모바일에서는 전역 헤더가 없다. 각 페이지가 <PageHeader>로 자기 헤더를 그린다. */}
      <AppHeader className="max-md:hidden" />

      <div className="flex min-h-0 flex-1">
        <AppSidebar className="max-md:hidden" />

        {/* 레이아웃(document / focused / immersive)이 이 칸을 채운다. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
