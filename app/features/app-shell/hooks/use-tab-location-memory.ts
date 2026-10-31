import { useEffect } from "react";
import { useLocation } from "react-router";

import { navItems } from "~/features/app-shell/model/nav-items";
import {
  rememberTabLocation,
  resolveTabTarget,
  type TabMemory,
} from "~/features/app-shell/model/tab-memory";

// `ScrollRegion`의 위치 기억처럼 모듈 수준 메모리다. 새로고침·앱 재시작 뒤에는 각 탭이 첫 화면에서
// 시작해야 하고, sessionStorage에 두면 계정이 바뀔 때 지워야 할 저장소가 하나 더 는다.
const tabMemory: TabMemory = new Map();

/** 테스트가 케이스 사이에 기억을 비운다. */
export function clearTabMemory() {
  tabMemory.clear();
}

/**
 * 지금 보는 화면을 그 탭의 마지막 위치로 적는다. 셸 layout이 한 번 부른다 — 탭바는 그룹 상세나
 * 대화방처럼 `bottomNav: "none"`인 화면에서 unmount되므로 nav 컴포넌트 안에서는 바로 그 화면을 놓친다.
 */
export function useTabLocationMemory() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    rememberTabLocation(tabMemory, { pathname, search });
  }, [pathname, search]);
}

/**
 * 탭 루트별 링크 `to`. 기록은 effect에서 하지만 렌더 때 읽어도 된다 — 현재 탭의 target은 기억과
 * 무관하게 첫 화면이고, 다른 탭의 기억은 그 탭을 떠난 뒤로 바뀌지 않는다.
 */
export function useTabTargets(): Record<string, string> {
  const { pathname } = useLocation();
  return Object.fromEntries(
    navItems.map((item) => [
      item.to,
      resolveTabTarget(item, pathname, tabMemory),
    ]),
  );
}
