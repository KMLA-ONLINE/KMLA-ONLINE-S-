import { useRef } from "react";
import {
  Outlet,
  useLocation,
  useMatches,
  useNavigation,
  useRevalidator,
} from "react-router";

import { storyKeys } from "~/features/stories/data/cache";
import {
  AppHeader,
  AppSidebar,
  MobileTabBar,
  NavigationSkeleton,
  PullToRefresh,
  resolveAppChrome,
  ScrollRegion,
} from "~/features/app-shell";
import { isPostOverlayNavigation } from "~/features/app-shell/model/navigation";
import { resetFeed } from "~/features/feed";
import { groupKeys } from "~/features/groups";
import { notificationKeys } from "~/features/notifications";
import { useHideOnScroll } from "~/shared/hooks/use-hide-on-scroll";
import { useDelayedPending } from "~/shared/hooks/use-delayed-pending";
import { getQueryClient } from "~/shared/lib/query-client";
import { cn } from "~/shared/lib/utils";

const CONTENT_WIDTH_CLASS = {
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  full: "max-w-none",
} as const;

export default function MainAppLayout() {
  const matches = useMatches();
  const location = useLocation();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const chrome = resolveAppChrome(matches);
  const scrollRef = useRef<HTMLElement>(null);
  const hidden = useHideOnScroll({
    containerRef: scrollRef,
    enabled:
      chrome.header === "hide-on-scroll" ||
      chrome.bottomNav === "hide-on-scroll",
  });
  const pendingPathname = navigation.location?.pathname;
  const groupDetailSearchNavigation =
    navigation.state === "loading" &&
    pendingPathname === location.pathname &&
    /^\/groups\/[^/]+$/.test(location.pathname) &&
    navigation.location.search !== location.search;
  const postOverlayNavigation =
    navigation.state === "loading" &&
    Boolean(pendingPathname) &&
    isPostOverlayNavigation(location.pathname, pendingPathname ?? "");
  const navigationPending =
    navigation.state === "loading" &&
    Boolean(pendingPathname) &&
    !groupDetailSearchNavigation &&
    !postOverlayNavigation;
  const showNavigationSkeleton = useDelayedPending(navigationPending);
  const skeletonPath = pendingPathname ?? location.pathname;

  const refresh = async () => {
    const queryClient = getQueryClient();
    const stale = (queryKey: readonly unknown[]) =>
      queryClient.invalidateQueries({ queryKey, refetchType: "none" });

    // 피드는 stale 표시가 아니라 리셋이다. 무한 쿼리에서 무효화는 "쌓인 페이지를 전부 다시
    // 읽어라"가 되는데, 당겨서 새로고침이 원하는 건 새 세션의 1페이지다.
    await Promise.all([
      location.pathname === "/"
        ? Promise.all([resetFeed(queryClient), stale(storyKeys.all)])
        : stale(groupKeys.all),
      stale(notificationKeys.badge()),
    ]);
    await revalidator.revalidate();
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background">
      {chrome.header === "none" ? null : (
        <AppHeader
          className={cn(
            "max-md:hidden",
            chrome.header === "hide-on-scroll" &&
              // 키보드 포커스가 안에 들어와 있으면 숨기지 않는다. `focus-within`이 아니라
              // `:focus-visible`을 보는 이유는 아래 탭바 주석에 있다.
              "transition-[margin,transform] duration-200 ease-out motion-reduce:transition-none md:has-[:focus-visible]:mt-0 md:has-[:focus-visible]:translate-y-0",
            chrome.header === "hide-on-scroll" &&
              hidden &&
              "md:-mt-[var(--app-header-h)] md:-translate-y-full",
          )}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <AppSidebar className="max-md:hidden" />

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <PullToRefresh
            containerRef={scrollRef}
            enabled={chrome.pullToRefresh}
            onRefresh={refresh}
          />
          <ScrollRegion
            scrollRef={scrollRef}
            className={cn(
              chrome.bottomNav === "hide-on-scroll" &&
                "max-md:pb-[calc(var(--app-tabbar-h)+var(--app-safe-b))]",
            )}
          >
            <div className="md:px-8">
              <div
                data-slot="app-content"
                data-content-width={chrome.contentWidth}
                className={cn(
                  "mx-auto w-full md:py-6",
                  CONTENT_WIDTH_CLASS[chrome.contentWidth],
                )}
              >
                {showNavigationSkeleton ? (
                  <NavigationSkeleton pathname={skeletonPath} />
                ) : (
                  <Outlet />
                )}
              </div>
            </div>
          </ScrollRegion>

          {chrome.bottomNav === "none" ? null : (
            <MobileTabBar
              className={cn(
                "md:hidden",
                // 키보드로 탭바에 들어와 있는 동안에는 숨기지 않는다. 포커스한 항목이
                // 발밑에서 사라지면 어디에 있는지 알 수 없다.
                //
                // `focus-within`이면 안 된다. 탭바의 링크는 **눌러도** 포커스를 받고,
                // 탭바는 route가 바뀌어도 리마운트되지 않아 그 포커스가 그대로 남는다.
                // 그래서 탭바로 한 번 이동하고 나면 `focus-within`이 계속 켜져 있고,
                // 그 선택자(0,2,0)가 `max-md:translate-y-full`(0,1,0 — 미디어 쿼리는
                // 특정도를 올리지 않는다)을 이겨서 자동 숨김이 영영 죽는다.
                //
                // `:focus-visible`은 포인터로 누른 링크에는 붙지 않으므로 탭 이동은
                // 숨김을 막지 않고, 키보드 이동만 막는다.
                chrome.bottomNav === "hide-on-scroll" &&
                  "absolute inset-x-0 bottom-0 transition-transform duration-200 ease-out has-[:focus-visible]:translate-y-0 motion-reduce:transition-none",
                chrome.bottomNav === "hide-on-scroll" &&
                  hidden &&
                  "max-md:translate-y-full",
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}
