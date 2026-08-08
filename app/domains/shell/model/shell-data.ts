import { useRouteLoaderData } from "react-router";

import type { ShellData } from "~/domains/shell/model/types";

/**
 * `domains/shell/routes/shell.tsx`의 라우트 id. `routes.ts`에 적은 파일 경로에서 `app/` 접두와
 * 확장자를 뺀 값이다. 파일을 옮기면 여기도 같이 바꿔야 하므로 상수로 묶어 둔다.
 */
export const SHELL_ROUTE_ID = "domains/shell/routes/shell";

/**
 * 셸 로더 데이터. 셸 아래 어느 라우트에서든 부를 수 있다.
 *
 * prop drilling(`<AppShell email={...} />`)도, 뱃지 전용 컨텍스트(`NotiProvider`)도 필요 없다.
 * 데이터가 로더에 있으면 트리 어디서든 라우트 id로 꺼낸다.
 */
export function useShellData(): ShellData {
  const data = useRouteLoaderData<ShellData>(SHELL_ROUTE_ID);

  if (!data) {
    // 셸 바깥(로그인 등)에서 부른 경우다. 조용히 빈 값을 주면 헤더가 빈 아바타를 그리며
    // 넘어가 버리니 여기서 끊는다.
    throw new Error(
      `useShellData()는 ${SHELL_ROUTE_ID} 아래에서만 쓸 수 있다.`,
    );
  }

  return data;
}

/** 내비 뱃지. 사이드바·탭바가 공용으로 쓴다. */
export function useNavBadges(): Record<string, number> {
  return useShellData().badges;
}
