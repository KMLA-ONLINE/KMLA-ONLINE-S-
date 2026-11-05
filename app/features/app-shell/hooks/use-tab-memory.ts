import { useEffect } from "react";
import { useLocation } from "react-router";

import { useAppShell } from "~/features/app-shell/context/app-shell-context";
import { createAccountMemory } from "~/features/app-shell/model/account-memory";
import {
  isNavItemActive,
  type NavItem,
} from "~/features/app-shell/model/nav-items";
import {
  TAB_RETURN_STATE,
  tabLocationEntry,
} from "~/features/app-shell/model/tab-memory";

/** 탭마다 마지막으로 본 주소. 새로고침하거나 계정이 바뀌면 잊는다. */
const tabHrefs = createAccountMemory(() => new Map<string, string>());

/**
 * 셸 layout에서 한 번 부른다. 지금 보는 화면을 그 탭의 마지막 주소로 기록한다. `remember`가 꺼진
 * 화면(`handle.chrome.rememberTab`, 폼)은 기록하지 않아 그 직전 화면이 남는다.
 *
 * 링크는 render에서 읽기만 한다. 위치가 바뀔 때마다 다시 그려지므로 반응형 상태가 필요 없다.
 */
export function useRememberTabLocation(remember: boolean) {
  const owner = useAppShell().profile.id;
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (!remember) return;
    const entry = tabLocationEntry(pathname, search);
    if (entry) tabHrefs(owner).set(entry.tab, entry.href);
  }, [owner, pathname, search, remember]);
}

/**
 * 탭 링크가 갈 곳. 다른 탭에서 누르면 그 탭에서 마지막으로 본 화면으로, 마지막 스크롤 위치까지
 * 돌아간다(`TAB_RETURN_STATE`). 지금 탭 안에서 누르면 탭의 첫 화면을 새 화면처럼 맨 위에서 연다.
 * 첫 화면에서 다시 누르는 경우는 각 링크의 재선택 처리가 가로챈다.
 */
export function useTabLink(): (item: NavItem) => {
  to: string;
  state: typeof TAB_RETURN_STATE | undefined;
} {
  const owner = useAppShell().profile.id;
  const { pathname } = useLocation();

  return (item) => {
    if (isNavItemActive(pathname, item))
      return { to: item.to, state: undefined };
    return {
      to: tabHrefs(owner).get(item.to) ?? item.to,
      state: TAB_RETURN_STATE,
    };
  };
}
