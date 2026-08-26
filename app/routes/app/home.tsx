import { MessagesSquareIcon, SearchIcon, UtensilsIcon } from "lucide-react";
import { Link } from "react-router";

import { defineAppChrome, PageHeader } from "~/features/app-shell";
import {
  FEED_STALE_TIME,
  FeedScreen,
  feedKeys,
  listFeedPosts,
} from "~/features/feed";
import { getKoreaDate, getMealDay, HomeMealSummary } from "~/features/meal";
import {
  BIRTHDAY_GC_TIME,
  BIRTHDAY_STALE_TIME,
  birthdayKeys,
  HomeBirthdaySummary,
  listBirthdays,
} from "~/features/profiles";
import { createPostListRevalidation } from "~/features/posts";
import { getQueryClient } from "~/shared/lib/query-client";
import { getKoreaDateIso } from "~/shared/lib/korea-date";
import { Button } from "~/shared/ui/button";
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

/**
 * `post`·`kind`·`source`는 게시물 상세 오버레이의 URL 상태이고, loader가 읽지 않는다. 이미지
 * 뷰어와 댓글 시트는 공용 규칙이 이미 무시한다.
 *
 * 피드에서는 이게 특히 비싸다. 첫 페이지를 다시 읽으면 `list_feed_posts`가 새 세션을 열어
 * `feedEpoch`가 바뀌고, `FeedScreen`이 무한 스크롤로 쌓아 둔 페이지를 전부 버린다.
 */
export const shouldRevalidate = createPostListRevalidation([
  "post",
  "kind",
  "source",
]);

// 첫 페이지는 로더가 await 한다. 이후 페이지는 useFetcher로 같은 clientLoader에 커서를 보낸다
// (AGENTS.md의 "Loaders await their data" — 스트리밍 스켈레톤이 필요한 화면에서만 예외).
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const pageToken = new URL(request.url).searchParams.get("pageToken");
  const queryClient = getQueryClient();
  const birthdayReferenceDate = getKoreaDateIso();
  const mealDayPromise = pageToken
    ? Promise.resolve(null)
    : getMealDay(getKoreaDate());
  const birthdaysPromise = pageToken
    ? Promise.resolve(null)
    : queryClient
        .fetchQuery({
          queryKey: birthdayKeys.today(birthdayReferenceDate),
          queryFn: () => listBirthdays(birthdayReferenceDate, "today"),
          staleTime: BIRTHDAY_STALE_TIME,
          gcTime: BIRTHDAY_GC_TIME,
        })
        .catch(() => null);

  try {
    const [page, mealDay, birthdays] = await Promise.all([
      queryClient.fetchQuery({
        queryKey: feedKeys.page(pageToken),
        queryFn: () => listFeedPosts(pageToken),
        staleTime: FEED_STALE_TIME,
      }),
      mealDayPromise,
      birthdaysPromise,
    ]);

    if (pageToken) {
      return {
        page,
        pageToken,
        error: null,
        expired: false,
        mealDay,
        birthdays,
      };
    }

    return {
      page,
      pageToken: null,
      error: null,
      expired: false,
      mealDay,
      birthdays,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "피드를 불러오지 못했습니다.";
    const expired = pageToken !== null && /expired|not found/i.test(message);
    const [mealDay, birthdays] = await Promise.all([
      mealDayPromise,
      birthdaysPromise,
    ]);

    if (pageToken) {
      return {
        page: null,
        pageToken,
        error: expired ? "피드가 만료되었습니다. 새로고침해 주세요." : message,
        expired,
        mealDay,
        birthdays,
      };
    }

    return {
      page: null,
      pageToken: null,
      error: message,
      expired: false,
      mealDay,
      birthdays,
    };
  }
}

export default function FeedPage({ loaderData }: Route.ComponentProps) {
  const { page, error, mealDay, birthdays } = loaderData;

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
        {mealDay || birthdays ? (
          <aside className="hidden space-y-3 self-start lg:block">
            {birthdays ? <HomeBirthdaySummary birthdays={birthdays} /> : null}
            {mealDay ? <HomeMealSummary day={mealDay} /> : null}
          </aside>
        ) : null}
      </div>
    </>
  );
}
