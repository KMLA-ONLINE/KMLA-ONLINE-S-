import { NavLink, useLocation } from "react-router";

import { NavBadge } from "~/features/app-shell/components/nav-badge";
import { useNavBadges } from "~/features/app-shell/context/app-shell-context";
import {
  isNavItemActive,
  navItems,
} from "~/features/app-shell/model/nav-items";
import { cn } from "~/shared/lib/utils";

/**
 * 모바일 하단 탭바. `fixed`가 아니라 셸 flex 흐름의 마지막 행이라 콘텐츠 하단 패딩 보정이 없다.
 * 표시·자동 숨김은 현재 route의 `handle.chrome.bottomNav`가 정한다.
 */
export function MobileTabBar({ className }: { className?: string }) {
  const location = useLocation();
  const badges = useNavBadges();

  return (
    <nav
      aria-label="주요 메뉴"
      className={cn(
        "z-20 shrink-0 border-t bg-background pb-[var(--app-safe-b)]",
        className,
      )}
    >
      <ul className="grid h-[var(--app-tabbar-h)] grid-cols-4">
        {navItems.map((item) => {
          const isActive = isNavItemActive(location.pathname, item);
          const unread = badges[item.to] ?? 0;

          return (
            <li key={item.to} className="min-w-0">
              {/* 아이콘만 있어 라벨(과 안 읽은 개수)을 접근성 이름으로 붙인다. */}
              <NavLink
                to={item.to}
                end={item.end}
                prefetch="intent"
                aria-label={
                  unread > 0
                    ? `${item.label} (안 읽음 ${unread}개)`
                    : item.label
                }
                className={cn(
                  "flex h-full w-full items-center justify-center px-1 text-muted-foreground",
                  isActive && "text-primary",
                )}
              >
                <span className="relative flex shrink-0">
                  <item.icon
                    className="size-5"
                    strokeWidth={isActive ? 2.5 : 2}
                  />
                  <NavBadge count={unread} className="ring-background" />
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
