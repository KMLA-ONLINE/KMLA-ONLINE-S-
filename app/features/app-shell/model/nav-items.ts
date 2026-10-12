import { BellIcon, HomeIcon, SchoolIcon, UsersRoundIcon } from "lucide-react";
import type { ComponentType } from "react";

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  /** 정확히 이 경로일 때만 활성. 루트("/")는 이게 없으면 모든 경로에서 활성이 된다. */
  end?: boolean;
}

/** 내비게이션의 단일 소스. 모바일은 네 항목, 데스크톱은 학교생활을 제외한다. */
export const navItems: NavItem[] = [
  { to: "/", label: "홈", icon: HomeIcon, end: true },
  { to: "/groups", label: "그룹", icon: UsersRoundIcon },
  { to: "/noti", label: "알림", icon: BellIcon },
  { to: "/menu", label: "학교생활", icon: SchoolIcon },
];

export const desktopNavItems = navItems.filter((item) => item.to !== "/menu");

/**
 * `startsWith`가 아니라 경계까지 본다. 그냥 `startsWith`면 `/groups`가 `/groupsomething`에서도
 * 활성이 된다.
 */
export function isNavItemActive(pathname: string, item: NavItem) {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
