import {
  isNavItemActive,
  navItems,
} from "~/features/app-shell/model/nav-items";
import { UI_OVERLAY_SEARCH_PARAMS } from "~/features/app-shell/model/navigation";

/** `navigate`의 `state`. 탭을 바꿔 돌아온 이동이면 그 화면의 마지막 스크롤 위치로 돌아간다. */
export const TAB_RETURN_STATE = { tabReturn: true } as const;

export function isTabReturnState(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    "tabReturn" in state &&
    state.tabReturn === true
  );
}

/**
 * 이 주소가 어느 탭의 화면인지와, 그 탭으로 돌아올 때 열 주소. 탭 밖의 화면(프로필, 관리자 등)이면
 * `null`이라 그 탭의 기억을 바꾸지 않는다. 폼은 route가 `handle.chrome.rememberTab`으로 뺀다.
 *
 * 이미지 뷰어·댓글 시트 같은 UI 쿼리는 뺀다. 돌아왔을 때 보던 화면은 그대로지만 덮개까지 다시 뜨면
 * 탭을 누른 게 아니라 뒤로 가기처럼 보인다.
 */
export function tabLocationEntry(
  pathname: string,
  search: string,
): { tab: string; href: string } | null {
  const item = navItems.find((navItem) => isNavItemActive(pathname, navItem));
  if (!item) return null;

  const params = new URLSearchParams(search);
  for (const key of UI_OVERLAY_SEARCH_PARAMS) params.delete(key);
  const query = params.toString();
  return { tab: item.to, href: query ? `${pathname}?${query}` : pathname };
}
