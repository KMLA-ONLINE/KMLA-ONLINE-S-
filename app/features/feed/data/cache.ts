import {
  infiniteQueryOptions,
  queryOptions,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";

import { listFeedPosts, signFeedMedia } from "~/features/feed/data/queries";
import {
  feedMediaPaths,
  type FeedMediaPaths,
  type FeedMediaUrls,
} from "~/features/feed/model/media";
import type { FeedPage } from "~/features/feed/model/types";

const FEED_STALE_TIME = 15_000;

export const feedKeys = {
  all: ["feed"] as const,
  list: () => [...feedKeys.all, "list"] as const,
};

/**
 * 피드는 페이지 하나가 아니라 세션 하나다. 서버가 첫 페이지에서 `feedEpoch`를 발급해 이후 토큰을 묶으므로,
 * 캐시 단위를 무한 쿼리 한 엔트리로 맞춘다(페이지별 키면 1페이지 리페치 때 나머지 토큰이 죽는다).
 */
export function feedQuery() {
  return infiniteQueryOptions({
    queryKey: feedKeys.list(),
    // 본문은 Storage 서명 왕복을 기다리지 않는다. 카드 화면이 미디어만 뒤에서 채운다.
    queryFn: ({ pageParam }) => listFeedPosts(pageParam, false),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: FeedPage) => lastPage.nextPageToken,
    staleTime: FEED_STALE_TIME,
    // 리페치는 쌓인 페이지를 전부 다시 읽는다. 시간 기반 갱신 대신 명시적 갱신만 쓴다 — 랭킹 피드가 조용히 재배열되지 않게.
    refetchOnMount: false,
  });
}

/**
 * 피드 페이지 하나의 미디어를 목록과 별도 수명으로 서명한다. 페이지가 붙어도 앞 페이지는 다시 서명하지 않는다.
 * 경로 목록을 키에 담고 `queryFn`은 키에서 읽는다 — 본문·반응이 든 게시물 snapshot을 캐시가 붙잡지 않게.
 */
export function feedMediaQuery(
  queryClient: QueryClient,
  page: {
    viewerId: number;
    feedEpoch: string | null;
    pageParam: string | null;
    paths: FeedMediaPaths;
  },
) {
  const pageKey = [
    ...feedKeys.all,
    "media",
    page.viewerId,
    page.feedEpoch,
    page.pageParam,
  ] as const;
  const queryKey = [...pageKey, page.paths] as const;
  return queryOptions<FeedMediaUrls, Error, FeedMediaUrls, typeof queryKey>({
    queryKey,
    queryFn: ({ queryKey }) => signFeedMedia(queryKey[5]),
    // 게시물을 빼면 키가 바뀐다. 같은 페이지의 이전 결과로 남은 이미지를 유지한다 — 병합은 경로로 찾으므로
    // 빠진 게시물의 URL이 섞여도 해가 없다.
    placeholderData: (): FeedMediaUrls | undefined => {
      const cached = queryClient
        .getQueriesData<FeedMediaUrls>({ queryKey: pageKey })
        .flatMap(([, data]) => (data ? [data] : []));
      if (cached.length === 0) return undefined;
      return cached.reduce<FeedMediaUrls>(
        (merged, data) => ({
          attachments: { ...merged.attachments, ...data.attachments },
          profiles: { ...merged.profiles, ...data.profiles },
        }),
        { attachments: {}, profiles: {} },
      );
    },
    // URL의 유효 기간은 공용 서명 캐시가 판단한다. 이 캐시에서 수명을 새로 시작하지 않는다.
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** 쌓인 피드 페이지마다의 미디어 쿼리. 화면과 로더의 prefetch가 같은 키를 만들도록 한 곳에서 짓는다. */
export function feedPageMediaQueries(
  queryClient: QueryClient,
  feed: InfiniteData<FeedPage, unknown> | undefined,
  viewerId: number,
) {
  const pages = feed?.pages ?? [];
  const feedEpoch = pages[0]?.feedEpoch ?? null;
  return pages.map((page, index) => ({
    postIds: page.posts.map((post) => post.post_id),
    query: feedMediaQuery(queryClient, {
      viewerId,
      feedEpoch,
      pageParam: (feed?.pageParams[index] as string | null | undefined) ?? null,
      paths: feedMediaPaths(page.posts),
    }),
  }));
}

/**
 * 로더가 목록을 받자마자 서명을 띄운다. 화면이 마운트된 뒤 `useQueries`가 시작하길 기다리지 않는다.
 * 기다리지 않고 실패도 삼킨다 — 화면이 같은 키로 이어받고 재시도도 화면이 맡는다.
 */
export function prefetchFeedMedia(queryClient: QueryClient, viewerId: number) {
  const feed = queryClient.getQueryData<InfiniteData<FeedPage, string | null>>(
    feedKeys.list(),
  );
  for (const { query } of feedPageMediaQueries(queryClient, feed, viewerId)) {
    void queryClient.query(query).catch(() => undefined);
  }
}

/**
 * 피드를 처음부터 다시 읽게 한다. `invalidateQueries`는 쌓인 페이지를 전부 다시 읽지만 여기서는 새 세션(새 `feedEpoch`)이 필요해 `resetQueries`다.
 * engagement overlay는 건드리지 않는다 — 비우면 다른 화면의 반응·댓글 수가 옛 snapshot으로 되돌아간다. overlay는 당겨서 새로고침이 버린다.
 */
export function resetFeed(queryClient: QueryClient) {
  return queryClient.resetQueries({ queryKey: feedKeys.list() });
}

/** 랭킹 재계산 없이 캐시에서 게시물 하나만 뺀다. 새 세션은 후보 전체를 다시 랭킹·물리화하는 비싼 일이다. */
export function removeFeedPost(queryClient: QueryClient, postId: string) {
  queryClient.setQueryData(
    feedKeys.list(),
    (current: InfiniteData<FeedPage, string | null> | undefined) => {
      if (!current) return current;

      let removed = false;
      const pages = current.pages.map((page) => {
        const posts = page.posts.filter((post) => post.post_id !== postId);
        if (posts.length === page.posts.length) return page;
        removed = true;
        return { ...page, posts };
      });

      return removed ? { ...current, pages } : current;
    },
  );
}
