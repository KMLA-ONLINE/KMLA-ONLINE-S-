import { NavLink, useLocation } from "react-router";

import { NavBadge } from "~/features/app-shell/components/nav-badge";
import { useNavBadges } from "~/features/app-shell/context/app-shell-context";
import {
  isNavItemActive,
  navItems,
} from "~/features/app-shell/model/nav-items";
import { cn } from "~/shared/lib/utils";

/**
 * 데스크톱 사이드바. 평소엔 아이콘 레일이고 hover/focus 하면 라벨까지 펼쳐진다.
 * shadcn `Sidebar`는 자체 높이·오프셋 가정이 `h-dvh` 흐름 셸과 싸워 쓰지 않는다. 확장은 CSS만으로 한다.
 * 바깥 `div`가 레일 폭을 예약하고 안쪽 `nav`가 겹쳐 펼쳐진다 — 흐름 안에서 늘리면 hover마다 본문이 밀린다.
 */
export function AppSidebar({ className }: { className?: string }) {
  const location = useLocation();
  const badges = useNavBadges();

  return (
    <div className={cn("relative w-[var(--app-rail-w)] shrink-0", className)}>
      <nav
        aria-label="주요 메뉴"
        className={cn(
          "group/sidebar absolute inset-y-0 left-0 z-30 flex w-[var(--app-rail-w)] flex-col overflow-hidden border-r border-transparent bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
          // `:focus-within`이 아니라 `:has(:focus-visible)`인 이유: 링크를 클릭하면 DOM
          // 포커스가 그대로 남아서, `focus-within`이면 마우스가 나가도 펼친 채로 굳는다.
          // `:focus-visible`은 브라우저가 키보드 이동일 때만 켜므로 Tab 접근성은 그대로 살고
          // 마우스 클릭으로는 켜지지 않는다.
          "has-[:focus-visible]:w-[var(--app-sidebar-w)] has-[:focus-visible]:border-border [@media(hover:hover)]:hover:w-[var(--app-sidebar-w)] [@media(hover:hover)]:hover:border-border",
          "motion-reduce:transition-none",
        )}
      >
        <ul className="flex flex-col gap-5 p-2 pt-6">
          {navItems.map((item) => {
            const isActive = isNavItemActive(location.pathname, item);
            const unread = badges[item.to] ?? 0;

            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  prefetch="intent"
                  aria-label={
                    unread > 0
                      ? `${item.label} (안 읽음 ${unread}개)`
                      : undefined
                  }
                  className={cn(
                    // px-3.5(14px)인 이유: 접힌 레일에서 아이콘을 중앙에 놓기 위해서다.
                    // 행이 flex라 아이콘(20px) + gap(12px)만으로도 레일 안쪽 폭을 넘겨서
                    // 라벨과 오른쪽 패딩이 잘려 나가고, 아이콘 위치는 왼쪽 패딩만으로 정해진다.
                    // 그래서 `ul`의 p-2(8px) + 여기 패딩 = (64 - 20) / 2 = 22px여야 한다.
                    "flex h-10 items-center gap-3 rounded-md px-3.5 transition-colors",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <span className="relative flex shrink-0">
                    <item.icon
                      className="size-5"
                      strokeWidth={isActive ? 2.5 : 2}
                    />
                    {/* 활성 항목은 알약 배경에 뱃지가 묻혀 색을 반전한다. */}
                    <NavBadge
                      count={unread}
                      className={
                        isActive
                          ? "bg-sidebar text-sidebar-primary ring-sidebar-primary"
                          : "ring-sidebar"
                      }
                    />
                  </span>
                  <span className="overflow-hidden text-sm whitespace-nowrap opacity-0 transition-opacity duration-200 group-has-[:focus-visible]/sidebar:opacity-100 motion-reduce:transition-none [@media(hover:hover)]:group-hover/sidebar:opacity-100">
                    {item.label}
                  </span>
                </NavLink>
              </li>
            );
          })}
        </ul>

        <p className="mt-auto overflow-hidden p-3 text-xs whitespace-nowrap text-muted-foreground opacity-0 transition-opacity duration-200 [@media(hover:hover)]:group-hover/sidebar:opacity-100">
          © {new Date().getFullYear()} from Dept. of SW &amp; Tech
        </p>
      </nav>
    </div>
  );
}
