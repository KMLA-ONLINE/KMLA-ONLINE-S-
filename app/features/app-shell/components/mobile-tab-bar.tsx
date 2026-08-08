import { NavLink, useLocation } from "react-router";

import { NavBadge } from "~/features/app-shell/components/nav-badge";
import { useNavBadges } from "~/features/app-shell/model/app-shell-context";
import {
  isNavItemActive,
  navItems,
} from "~/features/app-shell/model/nav-items";
import { cn } from "~/shared/lib/utils";

/**
 * 모바일 하단 탭바.
 *
 * `fixed`가 아니라 `document` 레이아웃의 flex 흐름 마지막 행이다. 그래서 콘텐츠가 탭바에 가리지
 * 않게 하려고 `pb-[calc(4rem+env(safe-area-inset-bottom))]`을 계산해 붙이는 코드가 아예 없다.
 *
 * 자동 숨김도 하지 않는다. 흐름 안에 있으니 사라지면 리플로우가 나고, 위쪽 `PageHeader`만
 * 숨어도 화면은 충분히 넓어진다.
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
      <ul className="grid h-[var(--app-tabbar-h)] grid-cols-5">
        {navItems.map((item) => {
          const isActive = isNavItemActive(location.pathname, item);
          const unread = badges[item.to] ?? 0;

          return (
            <li key={item.to} className="min-w-0">
              {/* 탭바는 아이콘만 그려서 링크에 읽을 텍스트가 없다 — 라벨을 접근성 이름으로 붙이고,
                  안 읽은 게 있으면 개수까지 이름에 담는다(뱃지 자체는 aria-hidden). */}
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
