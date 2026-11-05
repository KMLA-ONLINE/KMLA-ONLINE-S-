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
  NavigationProgress,
  NavigationSkeleton,
  PullToRefresh,
  resolveAppChrome,
  ScrollRegion,
} from "~/features/app-shell";
import { useKeyboardShellFrame } from "~/features/app-shell/hooks/use-keyboard-shell-frame";
import { useShellRefresh } from "~/features/app-shell/hooks/use-shell-refresh";
import {
  isPostOverlayNavigation,
  isSamePathUiOverlayNavigation,
} from "~/features/app-shell/model/navigation";
import { resetFeed } from "~/features/feed";
import { groupKeys } from "~/features/groups";
import { notificationKeys } from "~/features/notifications";
import { clearPostEngagement, collapseAllPostBodies } from "~/features/posts";
import { useHideOnScroll } from "~/shared/hooks/use-hide-on-scroll";
import { useServiceWorkerNavigation } from "~/shared/hooks/use-service-worker-navigation";
import { useDelayedPending } from "~/shared/hooks/use-delayed-pending";
import { getQueryClient } from "~/shared/lib/query-client";
import { scrollToTop } from "~/shared/lib/scroll-container";
import { cn } from "~/shared/lib/utils";

const CONTENT_WIDTH_CLASS = {
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  full: "max-w-none",
} as const;

/** 이 시간이 지나도 이동이 안 끝나면 이전 화면 대신 스켈레톤을 그린다. */
const NAVIGATION_SKELETON_DELAY_MS = 1000;

export default function MainAppLayout() {
  const matches = useMatches();
  const location = useLocation();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const chrome = resolveAppChrome(matches);
  // 알림을 누르면 떠 있는 창을 다시 불러오지 않고 앱 안에서 옮겨 간다.
  useServiceWorkerNavigation();
  const routeOwnsScroll = chrome.scroll === "route";
  const keyboardFrame = useKeyboardShellFrame(routeOwnsScroll);
  const scrollRef = useRef<HTMLElement>(null);
  const hidden = useHideOnScroll({
    containerRef: scrollRef,
    enabled:
      !routeOwnsScroll &&
      (chrome.header === "hide-on-scroll" ||
        chrome.bottomNav === "hide-on-scroll"),
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
  const uiOverlaySearchNavigation =
    navigation.state === "loading" &&
    Boolean(pendingPathname) &&
    isSamePathUiOverlayNavigation(
      location.pathname,
      location.search,
      pendingPathname ?? "",
      navigation.location.search,
    );
  const navigationPending =
    navigation.state === "loading" &&
    Boolean(pendingPathname) &&
    !groupDetailSearchNavigation &&
    !postOverlayNavigation &&
    !uiOverlaySearchNavigation;
  // 짧은 이동은 이전 화면을 그대로 두고 진행 막대만 띄운다. 화면을 스켈레톤으로 바꾸면 금방 끝나는
  // 이동마다 페이지 머리까지 깜빡인다. 오래 걸릴 때만 다음 화면 모양의 스켈레톤으로 바꿔 눌린 것을 보여 준다.
  const showNavigationProgress = useDelayedPending(navigationPending, {
    delay: 100,
  });
  // 스크롤을 직접 소유하는 화면(메신저)은 목록과 대화방이 한 route 트리라, 방을 옮기는 동안
  // 스켈레톤으로 바꾸면 그대로 둬야 할 대화 목록까지 사라진다. 진행 막대만 띄운다.
  const showNavigationSkeleton = useDelayedPending(
    navigationPending && !routeOwnsScroll,
    { delay: NAVIGATION_SKELETON_DELAY_MS },
  );
  const skeletonPath = pendingPathname ?? location.pathname;

  const refreshCaches = async () => {
    const queryClient = getQueryClient();
    const stale = (queryKey: readonly unknown[]) =>
      queryClient.invalidateQueries({ queryKey, refetchType: "none" });

    // 새 서버 snapshot이 기준이 되어야 하므로, 명시적 새로고침 전에 표시용 뮤테이션 값을 버린다.
    clearPostEngagement(queryClient);
    // 새로 읽은 목록은 접힌 채로 시작한다. 펼침 상태는 돌아왔을 때 위치를 맞추려고 기억해 둔 것이다.
    collapseAllPostBodies();

    // 피드는 stale 표시가 아니라 리셋이다. 무한 쿼리에서 무효화는 "쌓인 페이지를 전부 다시
    // 읽어라"가 되는데, 당겨서 새로고침이 원하는 건 새 세션의 1페이지다. 스토리는 홈 로더가
    // 캐시를 기다리지 않으므로 레일 observer가 지금 다시 읽게 하고 끝날 때까지 기다린다.
    await Promise.all([
      location.pathname === "/"
        ? Promise.all([
            resetFeed(queryClient),
            queryClient
              .invalidateQueries({ queryKey: storyKeys.all })
              .catch(() => undefined),
          ])
        : stale(groupKeys.all),
      stale(notificationKeys.badge()),
    ]);
    await revalidator.revalidate();
  };
  const { refreshing, refresh } = useShellRefresh(refreshCaches);
  // 데스크톱에는 당겨서 새로고침이 없다. 홈에서 홈을 다시 누르면 맨 위로 올리고 같은 새로고침을 한다.
  // 이미 새로고침 중이면 스크롤도 건드리지 않는다. 비워지는 목록 위에서 미끄러지기가 겹쳐 튄다.
  const refreshHome = () => {
    if (refresh()) scrollToTop(scrollRef.current);
  };

  return (
    <div
      data-slot="app-shell"
      className={cn(
        "fixed inset-0 flex flex-col bg-background",
        // 메신저 입력창에 포커스가 가면 브라우저가 가려진 입력창을 보이려고 `overflow-hidden`인 조상까지
        // 스크롤해 셸이 통째로 밀린다. `clip`은 스크롤 컨테이너가 아니라 밀리지 않는다.
        routeOwnsScroll ? "overflow-clip" : "overflow-hidden",
        keyboardFrame.className,
      )}
      style={keyboardFrame.style}
    >
      {/* 본문 열이 아니라 셸 맨 위에 둔다. 본문 열에 두면 데스크톱에서 헤더 아래, 사이드바 오른쪽부터
          그려지고, 스크롤로 숨는 헤더를 따라 위아래로 움직인다. */}
      {showNavigationProgress ? (
        <NavigationProgress className="absolute inset-x-0 top-[var(--app-safe-t)] z-50" />
      ) : null}
      {chrome.header === "none" ? null : (
        <AppHeader
          onHomeReselect={refreshHome}
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
        <AppSidebar className="max-md:hidden" onHomeReselect={refreshHome} />

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {routeOwnsScroll ? (
            <div className="flex min-h-0 min-w-0 flex-1 overflow-clip">
              <Outlet />
            </div>
          ) : (
            <>
              <PullToRefresh
                containerRef={scrollRef}
                enabled={chrome.pullToRefresh}
                refreshing={refreshing}
                onRefresh={refresh}
              />
              <ScrollRegion
                scrollRef={scrollRef}
                rememberScroll={chrome.rememberScroll}
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
            </>
          )}

          {chrome.bottomNav === "none" ? null : (
            <MobileTabBar
              scrollRef={scrollRef}
              className={cn(
                "md:hidden",
                // 키보드 포커스 중에는 숨기지 않는다. `focus-within`은 탭을 눌러도 포커스가 남아
                // (탭바는 리마운트되지 않음) 자동 숨김을 영영 죽이므로 `:focus-visible`을 쓴다.
                chrome.bottomNav === "hide-on-scroll" &&
                  "absolute inset-x-0 bottom-0 transition-transform duration-200 ease-out has-[:focus-visible]:translate-y-0 motion-reduce:transition-none",
                chrome.bottomNav === "hide-on-scroll" &&
                  hidden &&
                  "max-md:translate-y-full",
              )}
            />
          )}
          {/* 탭바가 숨어도 시스템 내비게이션 바 뒤 띠는 배경색으로 고정한다. */}
          {chrome.bottomNav === "hide-on-scroll" ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[var(--app-safe-b)] bg-background md:hidden"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
