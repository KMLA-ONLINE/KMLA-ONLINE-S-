import {
  BellIcon,
  HomeIcon,
  MessagesSquareIcon,
  ShapesIcon,
  UsersRoundIcon,
} from "lucide-react";
import type { ComponentType } from "react";

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  /** 정확히 이 경로일 때만 활성. 루트("/")는 이게 없으면 모든 경로에서 활성이 된다. */
  end?: boolean;
}

/** 모바일 탭바와 데스크톱 사이드바가 공유하는 주요 내비게이션. */
export const navItems: NavItem[] = [
  { to: "/", label: "홈", icon: HomeIcon, end: true },
  { to: "/messenger", label: "메시지", icon: MessagesSquareIcon },
  { to: "/groups", label: "그룹", icon: UsersRoundIcon },
  { to: "/noti", label: "알림", icon: BellIcon },
  { to: "/menu", label: "메뉴", icon: ShapesIcon },
];

/**
 * `startsWith`가 아니라 경계까지 본다. 그냥 `startsWith`면 `/groups`가 `/groupsomething`에서도
 * 활성이 된다.
 */
export function isNavItemActive(pathname: string, item: NavItem) {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
