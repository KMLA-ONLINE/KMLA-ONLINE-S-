import { MessagesSquareIcon, SearchIcon, UtensilsIcon } from "lucide-react";
import { Link, type ShouldRevalidateFunctionArgs } from "react-router";

import { defineAppChrome, PageHeader } from "~/features/app-shell";
import {
  FEED_STALE_TIME,
  FeedScreen,
  feedKeys,
  listFeedPosts,
} from "~/features/feed";
import { getKoreaDate, getMealDay, HomeMealSummary } from "~/features/meal";
import { Button } from "~/shared/ui/button";
import { getQueryClient } from "~/shared/lib/query-client";
import type { Route } from "./+types/home";

/**
 * 앱의 index 라우트. 전역 chrome은 아래 handle에서 명시한다.
 *
 * 셸에 대해 이 파일이 아는 것은 정확히 두 가지다.
 *   1. 모바일 헤더가 필요하면 `<PageHeader>`를 직접 그린다.
 *   2. 셸 데이터가 필요하면 `useAppShell()`로 읽는다.
 *
 * 페이지 헤더는 화면 콘텐츠라 이 설정과 별도로 페이지가 직접 그린다.
 */

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
  contentWidth: "5xl",
  pullToRefresh: true,
});

const FEED_UI_SEARCH_PARAMS = new Set(["post", "kind", "source", "view"]);

export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod && formMethod !== "GET") return true;
  if (currentUrl.href === nextUrl.href) return true;
  if (currentUrl.pathname !== nextUrl.pathname) return true;

  const changedKeys = new Set([
    ...currentUrl.searchParams.keys(),
    ...nextUrl.searchParams.keys(),
  ]);
  return !Array.from(changedKeys).every(
    (key) =>
      FEED_UI_SEARCH_PARAMS.has(key) ||
      currentUrl.searchParams.getAll(key).join("\0") ===
        nextUrl.searchParams.getAll(key).join("\0"),
  );
}

// 첫 페이지는 로더가 await 한다. 이후 페이지는 useFetcher로 같은 clientLoader에 커서를 보낸다
// (AGENTS.md의 "Loaders await their data" — 스트리밍 스켈레톤이 필요한 화면에서만 예외).
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const pageToken = new URL(request.url).searchParams.get("pageToken");
  const mealDayPromise = pageToken
    ? Promise.resolve(null)
    : getMealDay(getKoreaDate());

  try {
    const [page, mealDay] = await Promise.all([
      getQueryClient().fetchQuery({
        queryKey: feedKeys.page(pageToken),
        queryFn: () => listFeedPosts(pageToken),
        staleTime: FEED_STALE_TIME,
      }),
      mealDayPromise,
    ]);

    if (pageToken) {
      return {
        page,
        pageToken,
        error: null,
        expired: false,
        mealDay,
      };
    }

    return {
      page,
      pageToken: null,
      error: null,
      expired: false,
      mealDay,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "피드를 불러오지 못했습니다.";
    const expired = pageToken !== null && /expired|not found/i.test(message);
    const mealDay = await mealDayPromise;

    if (pageToken) {
      return {
        page: null,
        pageToken,
        error: expired ? "피드가 만료되었습니다. 새로고침해 주세요." : message,
        expired,
        mealDay,
      };
    }

    return {
      page: null,
      pageToken: null,
      error: message,
      expired: false,
      mealDay,
    };
  }
}

export default function FeedPage({ loaderData }: Route.ComponentProps) {
  const { page, error, mealDay } = loaderData;

  return (
    <>
      {/* 긴 목록에서는 페이지 헤더만 별도로 자동 숨김한다. */}
      <PageHeader
        title="KMLA Online"
        hideOnScroll
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              nativeButton={false}
              aria-label="급식"
              render={<Link to="/menu/meal" />}
            >
              <UtensilsIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              nativeButton={false}
              aria-label="검색"
              render={<Link to="/groups/discover" />}
            >
              <SearchIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              nativeButton={false}
              aria-label="메시지"
              render={<Link to="/messenger" />}
            >
              <MessagesSquareIcon />
            </Button>
          </>
        }
      />

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:py-4">
        <FeedScreen initialPage={page} initialError={error} />
        {mealDay ? <HomeMealSummary day={mealDay} /> : null}
      </div>
    </>
  );
}
