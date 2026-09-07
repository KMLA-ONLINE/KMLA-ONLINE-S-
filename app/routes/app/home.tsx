import { SearchIcon, UtensilsIcon } from "lucide-react";
import { Link } from "react-router";

import { StoryRail } from "~/features/stories/components/story-rail";
import { STORY_STALE_TIME, storyKeys } from "~/features/stories/data/cache";
import { listTodayStories } from "~/features/stories/data/queries";
import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import { hasActiveSession } from "~/features/auth";
import { FeedScreen, feedQuery } from "~/features/feed";
import { getKoreaDate, getMealDay, HomeMealSummary } from "~/features/meal";
import {
  BIRTHDAY_GC_TIME,
  BIRTHDAY_STALE_TIME,
  birthdayKeys,
  HomeBirthdaySummary,
  listBirthdays,
} from "~/features/profiles";
import { createPostListRevalidation } from "~/features/posts";
import {
  GlobalSearchDialog,
  useDirectorySearchDialog,
} from "~/features/search";
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
  bottomNav: "hide-on-scroll",
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

// 로더는 화면이 읽을 캐시를 데우는 일만 한다. 피드 자체는 `FeedScreen`이 무한 쿼리로
// 구독하므로 여기서 loaderData로 넘기지 않는다 — 넘기면 같은 데이터의 진실 소스가 둘이 된다.
export async function clientLoader() {
  // 게이트와 이 로더는 병렬로 돈다. 세션이 없으면 게이트가 /login으로 보내므로 아래 값은
  // 렌더되지 않지만, 그 전에 요청을 띄우면 인증 전용 RPC 세 개가 익명으로 나가 401이 된다.
  // 인증은 게이트가 판정하고, 여기서는 요청을 보내지 않는 것까지만 한다.
  if (!(await hasActiveSession())) {
    return { mealDay: null, birthdays: null, stories: [] };
  }

  const queryClient = getQueryClient();
  const referenceDate = getKoreaDateIso();

  const [mealDay, birthdays, stories] = await Promise.all([
    getMealDay(getKoreaDate()).catch(() => null),
    queryClient
      .query({
        queryKey: birthdayKeys.today(referenceDate),
        queryFn: () => listBirthdays(referenceDate, "today"),
        staleTime: BIRTHDAY_STALE_TIME,
        gcTime: BIRTHDAY_GC_TIME,
      })
      .catch(() => null),
    queryClient
      .query({
        queryKey: storyKeys.today(referenceDate),
        queryFn: listTodayStories,
        staleTime: STORY_STALE_TIME,
      })
      .catch(() => []),
    // 캐시에 이미 세션이 있으면 그대로 쓴다. 뒤로 가기로 돌아왔을 때 쌓아 둔 페이지를
    // 유지하려는 것이고, 갱신은 당겨서 새로고침처럼 명시적인 경로가 맡는다.
    queryClient.ensureInfiniteQueryData(feedQuery()).catch(() => null),
  ]);

  return { mealDay, birthdays, stories };
}

export default function FeedPage({ loaderData }: Route.ComponentProps) {
  const { mealDay, birthdays, stories } = loaderData;
  const { profile } = useAppShell();
  const { openSearch: openDirectorySearch } = useDirectorySearchDialog();

  return (
    <>
      <PageHeader
        title="KMLA Online"
        hideOnScroll
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label="검색"
              onClick={openDirectorySearch}
            >
              <SearchIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              nativeButton={false}
              aria-label="급식"
              render={<Link to="/menu/meal" />}
            >
              <UtensilsIcon />
            </Button>
          </>
        }
      />
      <GlobalSearchDialog />

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:py-4">
        <div className="min-w-0">
          {stories.length > 0 ? (
            <StoryRail initialItems={stories} viewerPubId={profile.pub_id} />
          ) : null}

          <FeedScreen />
        </div>

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
