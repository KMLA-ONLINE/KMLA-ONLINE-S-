import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listFeedPosts: vi.fn(),
  getMealDay: vi.fn(),
}));

vi.mock("~/features/feed", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listFeedPosts: mocks.listFeedPosts,
}));

vi.mock("~/features/meal", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getKoreaDate: () => "20260824",
  getMealDay: mocks.getMealDay,
}));

import { clientLoader, shouldRevalidate } from "~/routes/app/home";

const page = {
  posts: [],
  feedEpoch: "2026-08-24T08:00:00Z",
  nextPageToken: null,
};
const mealDay = { date: "20260824", meals: [], unavailable: false };

function load(query = "") {
  const url = `https://example.com/${query}`;
  return clientLoader({
    params: {},
    context: new RouterContextProvider(),
    request: new Request(url),
    url: new URL(url),
    pattern: "/",
    serverLoader: () => Promise.resolve(undefined),
  });
}

describe("home feed loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listFeedPosts.mockResolvedValue(page);
    mocks.getMealDay.mockResolvedValue(mealDay);
  });

  it("loads the first feed page and today's meal independently", async () => {
    const result = await load();

    expect(mocks.listFeedPosts).toHaveBeenCalledWith(null);
    expect(mocks.getMealDay).toHaveBeenCalledWith("20260824");
    expect(result).toMatchObject({ page, mealDay, error: null });
  });

  it("loads only the feed for an opaque pagination token", async () => {
    const token = "20000000-0000-0000-0000-000000000001";
    const result = await load(`?pageToken=${token}`);

    expect(mocks.listFeedPosts).toHaveBeenCalledWith(token);
    expect(mocks.getMealDay).not.toHaveBeenCalled();
    expect(result).toMatchObject({ page, pageToken: token, mealDay: null });
  });

  it("turns an expired token into a refreshable pagination result", async () => {
    mocks.listFeedPosts.mockRejectedValue(
      new Error("feed page not found or expired"),
    );

    const result = await load(
      "?pageToken=20000000-0000-0000-0000-000000000001",
    );

    expect(result).toMatchObject({
      page: null,
      expired: true,
      error: "피드가 만료되었습니다. 새로고침해 주세요.",
    });
  });
});

describe("home feed revalidation", () => {
  it("does not reload the feed for post overlay parameters", () => {
    expect(
      shouldRevalidate({
        currentUrl: new URL("https://example.com/"),
        nextUrl: new URL(
          "https://example.com/?post=post-id&kind=group&source=feed",
        ),
      } as never),
    ).toBe(false);
  });

  // 다시 읽으면 `listFeedPosts(null)`이 새 세션을 열고, 쌓아 둔 페이지가 전부 버려진다.
  it("does not open a new feed session when an image viewer opens", () => {
    expect(
      shouldRevalidate({
        currentUrl: new URL("https://example.com/"),
        nextUrl: new URL("https://example.com/?image=profile-activity-post-id"),
      } as never),
    ).toBe(false);
  });

  it("allows explicit same-url refreshes", () => {
    expect(
      shouldRevalidate({
        currentUrl: new URL("https://example.com/"),
        nextUrl: new URL("https://example.com/"),
      } as never),
    ).toBe(true);
  });
});
