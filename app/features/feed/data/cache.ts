import {
  infiniteQueryOptions,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";

import { listFeedPosts } from "~/features/feed/data/queries";
import type { FeedPage } from "~/features/feed/model/types";
import { readPostViewMode } from "~/features/posts/model/view-preference";

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
    queryFn: ({ pageParam }) =>
      listFeedPosts(pageParam, readPostViewMode() === "card"),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: FeedPage) => lastPage.nextPageToken,
    staleTime: FEED_STALE_TIME,
    // 리페치는 쌓인 페이지를 전부 다시 읽는다. 시간 기반 갱신 대신 명시적 갱신만 쓴다 — 랭킹 피드가 조용히 재배열되지 않게.
    refetchOnMount: false,
  });
}

/**
 * 피드를 처음부터 다시 읽게 한다. `invalidateQueries`는 쌓인 페이지를 전부 다시 읽지만 여기서는 새 세션(새 `feedEpoch`)이 필요해 `resetQueries`다.
 * engagement overlay는 건드리지 않는다 — 비우면 다른 화면의 반응·댓글 수가 옛 snapshot으로 되돌아간다. overlay는 당겨서 새로고침이 버린다.
 */
export function resetFeed(queryClient: QueryClient) {
  return queryClient.resetQueries({ queryKey: feedKeys.all });
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
