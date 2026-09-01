import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasActiveSession: vi.fn(),
  listFeedPosts: vi.fn(),
  getMealDay: vi.fn(),
  listBirthdays: vi.fn(),
  listTodayStories: vi.fn(),
}));

vi.mock("~/features/auth", () => ({
  hasActiveSession: mocks.hasActiveSession,
}));

vi.mock("~/features/stories/data/queries", () => ({
  listTodayStories: mocks.listTodayStories,
}));

// `feedQuery`의 queryFn이 배럴이 아니라 이 모듈에서 직접 가져다 쓴다.
vi.mock("~/features/feed/data/queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listFeedPosts: mocks.listFeedPosts,
}));

vi.mock("~/features/meal", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getKoreaDate: () => "20260824",
  getMealDay: mocks.getMealDay,
}));

vi.mock("~/features/profiles", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listBirthdays: mocks.listBirthdays,
}));

vi.mock("~/shared/lib/korea-date", () => ({
  getKoreaDateIso: () => "2026-08-24",
}));

import { clientLoader, shouldRevalidate } from "~/routes/app/home";
import { feedKeys } from "~/features/feed";
import type { BirthdayProfile } from "~/features/profiles";
import {
  getQueryClient,
  resetQueryClientForTests,
} from "~/shared/lib/query-client";

const page = {
  posts: [],
  feedEpoch: "2026-08-24T08:00:00Z",
  nextPageToken: null,
};
const mealDay = { date: "20260824", meals: [], unavailable: false };
const birthdays: BirthdayProfile[] = [];

// 커서가 URL에서 캐시로 옮겨가면서 이 로더는 인자를 받지 않는다.
function load() {
  return clientLoader();
}

describe("home feed loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryClientForTests();
    mocks.hasActiveSession.mockResolvedValue(true);
    mocks.listTodayStories.mockResolvedValue([]);
    mocks.listFeedPosts.mockResolvedValue(page);
    mocks.getMealDay.mockResolvedValue(mealDay);
    mocks.listBirthdays.mockResolvedValue(birthdays);
  });

  // 피드는 화면이 무한 쿼리로 구독한다. 로더는 캐시를 데우기만 하고 loaderData로 넘기지
  // 않는다 — 넘기면 같은 데이터의 진실 소스가 둘이 된다.
  it("warms the feed cache and loads today's meal independently", async () => {
    const result = await load();

    expect(mocks.listFeedPosts).toHaveBeenCalledWith(null, true);
    expect(mocks.getMealDay).toHaveBeenCalledWith("20260824");
    expect(mocks.listBirthdays).toHaveBeenCalledWith("2026-08-24", "today");
    expect(result).toMatchObject({ mealDay, birthdays });
    expect(result).not.toHaveProperty("page");
    expect(getQueryClient().getQueryData(feedKeys.list())).toMatchObject({
      pages: [page],
    });
  });

  // 뒤로 가기로 돌아왔을 때 쌓아 둔 페이지를 유지하기 위한 것이다. 여기서 다시 읽으면
  // 무한 쿼리가 모든 페이지를 다시 읽고, 새 feedEpoch가 목록을 통째로 갈아치운다.
  it("reuses an existing feed session instead of refetching", async () => {
    await load();
    mocks.listFeedPosts.mockClear();

    await load();

    expect(mocks.listFeedPosts).not.toHaveBeenCalled();
  });

  // 게이트와 병렬로 도는 로더다. 세션이 없을 때 요청을 띄우면 authenticated 전용 RPC가
  // 익명으로 나가고, PostgREST가 401을 돌려주며 콘솔을 더럽힌다.
  it("issues no request when there is no session", async () => {
    mocks.hasActiveSession.mockResolvedValue(false);

    const result = await load();

    expect(mocks.listFeedPosts).not.toHaveBeenCalled();
    expect(mocks.listBirthdays).not.toHaveBeenCalled();
    expect(mocks.listTodayStories).not.toHaveBeenCalled();
    expect(mocks.getMealDay).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      mealDay: null,
      birthdays: null,
      stories: [],
    });
  });
});

/**
 * 규칙 자체는 `createPostListRevalidation`의 테스트가 전부 확인한다. 이 route에만 있는
 * 사실은 넘긴 오버레이 파라미터 목록 하나뿐이라, 여기서는 그것만 고정한다 — 하나라도 빠지면
 * 게시물 오버레이를 여는 것만으로 `listFeedPosts(null)`이 새 피드 세션을 연다.
 */
describe("home feed revalidation", () => {
  it("treats the post overlay parameters as UI-only", () => {
    expect(
      shouldRevalidate({
        currentUrl: new URL("https://example.com/"),
        nextUrl: new URL(
          "https://example.com/?post=post-id&kind=group&source=feed",
        ),
      } as never),
    ).toBe(false);
  });
});
