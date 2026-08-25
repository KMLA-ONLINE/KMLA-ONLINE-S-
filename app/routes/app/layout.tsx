import { useRef } from "react";
import {
  Outlet,
  useLocation,
  useMatches,
  useNavigation,
  useRevalidator,
} from "react-router";

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
import { feedKeys } from "~/features/feed";
import { groupKeys } from "~/features/groups";
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
    await queryClient.invalidateQueries({
      queryKey: location.pathname === "/" ? feedKeys.all : groupKeys.all,
      refetchType: "none",
    });
    await revalidator.revalidate();
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background">
      {chrome.header === "none" ? null : (
        <AppHeader
          className={cn(
            "max-md:hidden",
            chrome.header === "hide-on-scroll" &&
              "transition-[margin,transform] duration-200 ease-out motion-reduce:transition-none md:focus-within:mt-0 md:focus-within:translate-y-0",
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
          <ScrollRegion scrollRef={scrollRef}>
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
                chrome.bottomNav === "hide-on-scroll" &&
                  "transition-[margin,transform] duration-200 ease-out focus-within:mb-0 focus-within:translate-y-0 motion-reduce:transition-none",
                chrome.bottomNav === "hide-on-scroll" &&
                  hidden &&
                  "max-md:-mb-[calc(var(--app-tabbar-h)+var(--app-safe-b))] max-md:translate-y-full",
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}
