import type { PluginListenerHandle } from "@capacitor/core";
import type { TabBarPlugin } from "@capawesome/capacitor-tab-bar";
import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router";

import { useNavBadges } from "~/features/app-shell/context/app-shell-context";
import { formatBadgeCount } from "~/features/app-shell/model/badges";
import {
  isNavItemActive,
  navItems,
} from "~/features/app-shell/model/nav-items";
import { isTabReselectClick } from "~/features/app-shell/model/navigation";
import { scrollToTop } from "~/shared/lib/scroll-container";

/** 각 탭의 SF Symbol 이름. 선택된 탭은 UIKit이 채워진 변형을 알아서 쓴다. */
const SYSTEM_IMAGES: Record<string, string> = {
  "/": "house",
  "/messenger": "bubble.left.and.bubble.right",
  "/groups": "person.2",
  "/noti": "bell",
  "/menu": "square.grid.2x2",
};

/**
 * 셸의 `md` 경계. 이 폭부터는 웹과 같이 데스크톱 사이드바가 주요 내비게이션이라(iPad, 가로 iPhone)
 * 네이티브 탭바를 숨긴다. `app/app.css`의 `md:` 분기와 같은 값이어야 한다.
 */
const WIDE_SHELL_QUERY = "(min-width: 768px)";

/** 네이티브 탭에는 보조키가 없으므로 평범한 왼쪽 클릭으로 판정한다. */
const PLAIN_CLICK = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};

interface TabBarModule {
  TabBar: TabBarPlugin;
}

// 플러그인 호출은 순서가 중요하다(탭을 넣기 전에 show를 부르면 빈 바가 뜬다). 한 줄로 세운다.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: (module: TabBarModule) => Promise<T>): Promise<T> {
  const next = queue.then(() =>
    import("@capawesome/capacitor-tab-bar").then(task),
  );
  queue = next.catch(() => undefined);
  return next;
}

function subscribeWideShell(onChange: () => void) {
  const media = window.matchMedia(WIDE_SHELL_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function readWideShell() {
  return window.matchMedia(WIDE_SHELL_QUERY).matches;
}

/**
 * iOS 앱(네이티브 셸)에서 HTML 탭바 대신 iOS 네이티브 탭바(iOS 26부터 리퀴드 글라스)를 띄운다.
 *
 * 탭 id는 `navItems`의 경로다. 표시 규칙은 HTML 탭바와 같이 route의 `handle.chrome.bottomNav`를
 * 따르되(`none`이면 숨김), 스크롤 자동 숨김은 없고 `md` 이상 폭에서는 사이드바에 자리를 내준다.
 * 플러그인이 탭바 높이만큼 웹뷰의 하단 safe area를 늘리므로 콘텐츠는 기존 `--app-safe-b`
 * 여백만으로 비켜 선다. 같은 탭을 다시 누르면 맨 위로 올리는 규칙(§3.9)도 그대로다.
 *
 * 플러그인을 부르는 곳은 이 훅뿐이다. 다른 플러그인으로 바꿔도 셸은 그대로여야 한다.
 */
export function useNativeTabBar({
  enabled,
  visible,
  scrollRef,
}: {
  enabled: boolean;
  visible: boolean;
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const badges = useNavBadges();
  const wide = useSyncExternalStore(
    subscribeWideShell,
    readWideShell,
    () => false,
  );
  // 탭 선택 리스너는 한 번만 달고, 판정에 쓰는 현재 위치는 ref로 최신을 본다.
  const locationRef = useRef(location);
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  const activeId = navItems.find((item) =>
    isNavItemActive(location.pathname, item),
  )?.to;
  // 객체가 아니라 문자열로 비교해야 렌더마다 플러그인을 다시 부르지 않는다.
  const badgeKey = navItems.map((item) => badges[item.to] ?? 0).join(",");
  const shown = visible && !wide;

  useEffect(() => {
    if (!enabled) return;
    const counts = badgeKey.split(",").map(Number);
    void enqueue(({ TabBar }) =>
      TabBar.setTabs({
        tabs: navItems.map((item, index) => {
          const badge = formatBadgeCount(counts[index]);
          return {
            id: item.to,
            title: item.label,
            systemImage: SYSTEM_IMAGES[item.to],
            ...(badge === null ? {} : { badge }),
          };
        }),
      }),
    );
  }, [enabled, badgeKey]);

  useEffect(() => {
    if (!enabled || !activeId) return;
    void enqueue(({ TabBar }) => TabBar.selectTabById({ id: activeId }));
  }, [enabled, activeId]);

  useEffect(() => {
    if (!enabled) return;
    void enqueue(({ TabBar }) => (shown ? TabBar.show() : TabBar.hide()));
  }, [enabled, shown]);

  // 로그아웃 등으로 셸이 사라지면 탭바도 같이 사라져야 한다. 로그인 화면 위에 남으면 안 된다.
  useEffect(() => {
    if (!enabled) return;
    return () => {
      void enqueue(({ TabBar }) => TabBar.hide());
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let handle: PluginListenerHandle | undefined;

    void enqueue(async ({ TabBar }) => {
      const listener = await TabBar.addListener("tabSelected", ({ id }) => {
        if (isTabReselectClick(PLAIN_CLICK, locationRef.current, id)) {
          scrollToTop(scrollRef.current);
          return;
        }
        void navigate(id);
      });
      if (cancelled) {
        void listener.remove();
        return;
      }
      handle = listener;
    });

    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, [enabled, navigate, scrollRef]);
}
