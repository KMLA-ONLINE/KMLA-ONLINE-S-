import {
  isNavItemActive,
  navItems,
  type NavItem,
} from "~/features/app-shell/model/nav-items";
import { UI_OVERLAY_SEARCH_PARAMS } from "~/features/app-shell/model/navigation";

/** 탭 루트(`NavItem.to`) → 그 탭에서 마지막으로 보던 `pathname + search`. */
export type TabMemory = Map<string, string>;

/** 이 경로를 활성으로 표시하는 탭. 프로필·지원·초대·관리자처럼 어느 탭도 아닌 화면은 `null`. */
export function navItemForPathname(pathname: string): NavItem | null {
  return navItems.find((item) => isNavItemActive(pathname, item)) ?? null;
}

/**
 * 탭이 기억할 위치. 이미지 뷰어·댓글 시트·반응 목록 파라미터는 떼어 두어 돌아왔을 때 닫힌 채로
 * 열리게 하고, `?tab=members` 같은 화면 상태는 남긴다. hash는 기억하지 않는다.
 */
function tabLocationToRemember({
  pathname,
  search,
}: {
  pathname: string;
  search: string;
}): string {
  const params = new URLSearchParams(search);
  for (const key of UI_OVERLAY_SEARCH_PARAMS) params.delete(key);
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

/** 지금 보는 화면을 그 탭의 마지막 위치로 적는다. 탭에 속하지 않는 화면은 건드리지 않는다. */
export function rememberTabLocation(
  memory: TabMemory,
  location: { pathname: string; search: string },
): void {
  const item = navItemForPathname(location.pathname);
  if (!item) return;
  memory.set(item.to, tabLocationToRemember(location));
}

/**
 * 탭을 누르면 갈 곳. 다른 탭에서 누르면 기억한 화면으로 돌아가고, 이미 그 탭 안에 있으면 탭의
 * 첫 화면으로 간다 — 첫 화면에서 다시 누르는 경우는 `isTabReselectClick`이 따로 가로챈다.
 */
export function resolveTabTarget(
  item: NavItem,
  currentPathname: string,
  memory: TabMemory,
): string {
  if (isNavItemActive(currentPathname, item)) return item.to;
  return memory.get(item.to) ?? item.to;
}
