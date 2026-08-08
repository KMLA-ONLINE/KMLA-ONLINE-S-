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
 *
 * shadcn `Sidebar` + `SidebarProvider`를 쓰지 않는다. 그쪽은 자체 높이·flex·오프셋 가정이 있어서
 * `h-dvh` 흐름 셸과 싸운다. 여기서는 셸의 flex 행 안에 그냥 들어가므로 높이 계산이 아예 없다.
 *
 * 확장은 CSS만으로 한다 — 폭 트랜지션 하나, JS 상태 없음. 사용자가 펼침을 고정하고 싶어지면
 * 그때 상태를 붙이면 되고, 그 전까진 상태가 없다.
 *
 * 바깥 `div`가 레일 폭을 흐름에서 예약하고 안쪽 `nav`가 그 위에 겹쳐서 펼쳐진다. 흐름 안에서
 * 폭을 늘리면 hover 할 때마다 본문이 밀려서 읽던 위치가 흔들린다.
 */
export function AppSidebar({ className }: { className?: string }) {
  const location = useLocation();
  const badges = useNavBadges();

  return (
    <div className={cn("relative w-[var(--app-rail-w)] shrink-0", className)}>
      <nav
        aria-label="주요 메뉴"
        className={cn(
          "group/sidebar absolute inset-y-0 left-0 z-30 flex w-[var(--app-rail-w)] flex-col overflow-hidden border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
          // `:focus-within`이 아니라 `:has(:focus-visible)`인 이유: 링크를 클릭하면 DOM
          // 포커스가 그대로 남아서, `focus-within`이면 마우스가 나가도 펼친 채로 굳는다.
          // `:focus-visible`은 브라우저가 키보드 이동일 때만 켜므로 Tab 접근성은 그대로 살고
          // 마우스 클릭으로는 켜지지 않는다.
          "hover:w-[var(--app-sidebar-w)] has-[:focus-visible]:w-[var(--app-sidebar-w)]",
          "motion-reduce:transition-none",
        )}
      >
        <ul className="flex flex-col gap-5 p-2 pt-6">
          {navItems.map((item) => {
            const isActive = isNavItemActive(location.pathname, item);
            const unread = badges[item.to] ?? 0;

            return (
              <li key={item.to}>
                {/* prefetch="intent": 아직 로더가 없어도 라우트의 코드 분할 청크를 미리 데운다. */}
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
                    "flex h-10 items-center gap-3 rounded-md px-3 transition-colors",
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
                    {/* 활성 항목은 뒤에 색 알약이 깔려 뱃지가 묻힌다. 그때만 색을 반전시켜
                        알약에서 파낸 것처럼 보이게 한다. */}
                    <NavBadge
                      count={unread}
                      className={
                        isActive
                          ? "bg-sidebar text-sidebar-primary ring-sidebar-primary"
                          : "ring-sidebar"
                      }
                    />
                  </span>
                  <span className="overflow-hidden text-sm whitespace-nowrap opacity-0 transition-opacity duration-200 group-hover/sidebar:opacity-100 group-has-[:focus-visible]/sidebar:opacity-100 motion-reduce:transition-none">
                    {item.label}
                  </span>
                </NavLink>
              </li>
            );
          })}
        </ul>

        <p className="mt-auto overflow-hidden p-3 text-xs whitespace-nowrap text-muted-foreground opacity-0 transition-opacity duration-200 group-hover/sidebar:opacity-100">
          © {new Date().getFullYear()} from Dept. of SW &amp; Tech
        </p>
      </nav>
    </div>
  );
}
