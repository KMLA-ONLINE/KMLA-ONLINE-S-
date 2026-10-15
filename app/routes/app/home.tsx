import { SearchIcon, UtensilsIcon } from "lucide-react";
import { Suspense, use, useEffect } from "react";
import { Link, useRevalidator } from "react-router";

import { StoryRail } from "~/features/stories/components/story-rail";
import { STORY_STALE_TIME, storyKeys } from "~/features/stories/data/cache";
import {
  listActiveStories,
  type StoryItem,
} from "~/features/stories/data/queries";
import {
  defineAppChrome,
  PageHeader,
  readShellProfileId,
  useAppShell,
} from "~/features/app-shell";
import {
  isWideHome,
  useWideHome,
} from "~/features/app-shell/hooks/use-wide-home";
import { useHomeSidebarPreferences } from "~/features/app-shell/hooks/use-home-sidebar-preferences";
import { readHomeSidebarPreferences } from "~/features/app-shell/storage/home-sidebar-preferences";
import { hasActiveSession } from "~/features/auth";
import { FeedScreen, feedQuery, prefetchFeedMedia } from "~/features/feed";
import {
  getMealDay,
  getMealReferenceDate,
  HomeMealSummary,
  HomeMealSummarySkeleton,
  type MealDay,
} from "~/features/meal";
import {
  BIRTHDAY_GC_TIME,
  BIRTHDAY_STALE_TIME,
  birthdayKeys,
  type BirthdayProfile,
  HomeBirthdaySummary,
  HomeBirthdaySummarySkeleton,
  listBirthdays,
} from "~/features/profiles";
import { createPostListRevalidation } from "~/features/posts";
import { readPostViewMode } from "~/features/posts/model/view-preference";
import { GlobalSearchDialog } from "~/features/search";
import { HomeTimetableSummary } from "~/features/timetable";
import { useSearchDialogParam } from "~/shared/hooks/use-search-dialog-param";
import { getQueryClient } from "~/shared/lib/query-client";
import { getKoreaDateIso } from "~/shared/lib/korea-date";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Separator } from "~/shared/ui/separator";
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
  // 피드는 하단 탭으로 오가는 화면이라 뒤로 가기만으로는 위치가 안 남는다.
  rememberScroll: true,
});

/**
 * `post`·`kind`·`source`는 게시물 상세 오버레이의, `story`는 스토리 뷰어·작성 창의 URL
 * 상태이고, loader가 읽지 않는다. 이미지
 * 뷰어와 댓글 시트는 공용 규칙이 이미 무시한다.
 *
 * 피드에서는 이게 특히 비싸다. 첫 페이지를 다시 읽으면 `list_feed_posts`가 새 세션을 열어
 * `feedEpoch`가 바뀌고, `FeedScreen`이 무한 스크롤로 쌓아 둔 페이지를 전부 버린다.
 */
export const shouldRevalidate = createPostListRevalidation([
  "post",
  "kind",
  "source",
  "story",
]);

// 로더는 화면이 읽을 캐시를 데우는 일만 한다. 피드 자체는 `FeedScreen`이 무한 쿼리로
// 구독하므로 여기서 loaderData로 넘기지 않는다 — 넘기면 같은 데이터의 진실 소스가 둘이 된다.
export async function clientLoader() {
  // 게이트와 이 로더는 병렬로 돈다. 세션이 없으면 게이트가 /login으로 보내므로 아래 값은
  // 렌더되지 않지만, 그 전에 요청을 띄우면 인증 전용 RPC 세 개가 익명으로 나가 401이 된다.
  // 인증은 게이트가 판정하고, 여기서는 요청을 보내지 않는 것까지만 한다.
  if (!(await hasActiveSession())) {
    return {
      mealDay: Promise.resolve(null),
      birthdays: Promise.resolve(null),
      stories: [],
    };
  }

  const queryClient = getQueryClient();
  const referenceDate = getKoreaDateIso();

  // 급식과 생일은 넓은 화면의 옆 칸에만 보인다. 기다리면 피드 전체가 가장 느린 요청 —
  // 특히 외부 NEIS API — 에 묶이므로 promise째 넘기고 옆 칸만 따로 채운다.
  // 끼니는 시간대로 고르므로(19시 이후는 조식) 날짜도 같은 기준으로 넘긴다. 오늘 날짜로 받으면
  // 저녁에 이미 지난 오늘 아침 조식이 뜬다. 급식 화면과 같은 기준이다.
  const preferences = readHomeSidebarPreferences();
  const sidebarEnabled = isWideHome() && preferences.enabled;
  const mealDay =
    sidebarEnabled && preferences.meal
      ? getMealDay(getMealReferenceDate()).catch(() => null)
      : null;
  const birthdays =
    sidebarEnabled && preferences.birthdays
      ? queryClient
          .query({
            queryKey: birthdayKeys.today(referenceDate),
            queryFn: () => listBirthdays(referenceDate, "today"),
            staleTime: BIRTHDAY_STALE_TIME,
            gcTime: BIRTHDAY_GC_TIME,
          })
          .catch(() => null)
      : null;

  // 스토리 캐시가 있으면 오래됐어도 그대로 그린다. 기다리면 2분이 지날 때마다 홈 진입이 목록 RPC와
  // 서명 왕복에 묶인다. 다시 읽는 일은 마운트되는 레일의 `useQuery`가 뒤에서 맡는다.
  const cachedStories = queryClient.getQueryData<StoryItem[]>(
    storyKeys.active(),
  );
  const [stories] = await Promise.all([
    cachedStories ??
      queryClient
        .query({
          queryKey: storyKeys.active(),
          queryFn: listActiveStories,
          staleTime: STORY_STALE_TIME,
        })
        .catch(() => []),
    // 캐시에 이미 세션이 있으면 그대로 쓴다. 뒤로 가기로 돌아왔을 때 쌓아 둔 페이지를
    // 유지하려는 것이고, 갱신은 당겨서 새로고침처럼 명시적인 경로가 맡는다.
    queryClient.ensureInfiniteQueryData(feedQuery()).catch(() => null),
  ]);

  // 목록을 받았으니 화면 마운트를 기다리지 않고 카드 미디어 서명을 띄운다. 키에 들어갈 프로필 ID는
  // 병렬로 도는 게이트가 넣는다. 아직 없으면 건너뛰고 화면이 같은 키로 시작한다.
  const viewerId = readShellProfileId();
  if (viewerId !== null && readPostViewMode() === "card") {
    prefetchFeedMedia(queryClient, viewerId);
  }

  return { mealDay, birthdays, stories };
}

export default function FeedPage({ loaderData }: Route.ComponentProps) {
  const { mealDay, birthdays, stories } = loaderData;
  const { profile } = useAppShell();
  const wide = useWideHome();
  const [preferences] = useHomeSidebarPreferences();
  const showSidebar =
    wide &&
    preferences.enabled &&
    (preferences.birthdays || preferences.meal || preferences.timetable);
  const { revalidate } = useRevalidator();
  const needsSidebarData =
    showSidebar &&
    ((preferences.birthdays && birthdays === null) ||
      (preferences.meal && mealDay === null));
  // 모바일 진입 때 생략한 요약은 넓어진 뒤 로더로 채운다. 피드 세션은 캐시에서 재사용한다.
  // 필요해진 순간 한 번만 부른다. 다른 탭에서 바꾼 설정이나 폭 경계로 loader가 또 생략해도
  // 반복하지 않는다 — 재검증 상태를 의존성에 넣으면 끝날 때마다 다시 불러 NEIS를 계속 두드린다.
  useEffect(() => {
    if (needsSidebarData) void revalidate();
  }, [needsSidebarData, revalidate]);
  const { openSearch: openDirectorySearch } = useSearchDialogParam();

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

      {/* 사이드바가 없을 때의 최대 폭: 기존 5xl(64rem) - 사이드바(18rem) - 간격(1.5rem). */}
      <div
        className={cn(
          "grid min-w-0 gap-5",
          showSidebar
            ? "lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-6"
            : "mx-auto w-full lg:max-w-[44.5rem]",
        )}
      >
        <div className="min-w-0">
          <StoryRail
            initialItems={stories}
            viewer={{
              pubId: profile.pub_id,
              name: profile.name,
              avatarUrl: profile.avatar_url,
            }}
            canWrite={profile.type !== "alumni"}
          />

          <FeedScreen />
        </div>

        {showSidebar ? (
          <aside
            aria-label="학교생활 요약"
            className="hidden min-w-0 flex-col gap-3 self-start lg:flex"
          >
            {/* 경계 밖에서 공간을 확보해 준비된 요약부터 독립적으로 표시한다. */}
            {preferences.birthdays ? (
              <div className="grid min-h-20 min-w-0">
                <Suspense fallback={<HomeBirthdaySummarySkeleton />}>
                  {birthdays ? (
                    <DeferredBirthdays birthdays={birthdays} />
                  ) : (
                    <HomeBirthdaySummarySkeleton />
                  )}
                </Suspense>
              </div>
            ) : null}
            {preferences.birthdays && preferences.meal ? <Separator /> : null}
            {preferences.meal ? (
              <div className="grid min-h-48 min-w-0">
                <Suspense fallback={<HomeMealSummarySkeleton />}>
                  {mealDay ? (
                    <DeferredMeal mealDay={mealDay} />
                  ) : (
                    <HomeMealSummarySkeleton />
                  )}
                </Suspense>
              </div>
            ) : null}
            {preferences.timetable &&
            (preferences.birthdays || preferences.meal) ? (
              <Separator />
            ) : null}
            {/* aside가 보이지 않는 폭에서는 시간표를 불러오지 않는다. */}
            {preferences.timetable ? (
              <HomeTimetableSummary profileId={profile.id} />
            ) : null}
          </aside>
        ) : null}
      </div>
    </>
  );
}

function DeferredBirthdays({
  birthdays,
}: {
  birthdays: Promise<BirthdayProfile[] | null>;
}) {
  const value = use(birthdays);
  return <HomeBirthdaySummary birthdays={value} />;
}

function DeferredMeal({ mealDay }: { mealDay: Promise<MealDay | null> }) {
  const value = use(mealDay);
  return <HomeMealSummary day={value} />;
}
