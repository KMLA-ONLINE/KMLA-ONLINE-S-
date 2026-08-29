import {
  infiniteQueryOptions,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";

import { listFeedPosts } from "~/features/feed/data/queries";
import type { FeedPage } from "~/features/feed/model/types";
import { readPostViewMode } from "~/features/posts/model/view-preference";

export const FEED_STALE_TIME = 15_000;

export const feedKeys = {
  all: ["feed"] as const,
  list: () => [...feedKeys.all, "list"] as const,
};

/**
 * 피드는 페이지 하나가 아니라 세션 하나다.
 *
 * `list_feed_posts`는 첫 페이지에서 `feedEpoch`를 발급하고 이후 페이지 토큰을 거기에 묶는다.
 * 페이지마다 캐시 키를 따로 두면 서버가 "한 덩어리"라고 말하는 걸 클라이언트가 "낱개"로
 * 저장하는 셈이라, 1페이지를 다시 읽는 순간 나머지 토큰이 전부 죽었다. 무한 쿼리는 pages와
 * pageParams를 한 엔트리로 다루고 리페치할 때 1페이지부터 순차로 새 토큰을 흘려보내므로,
 * 캐시 단위가 서버의 일관성 단위와 맞는다.
 */
export function feedQuery() {
  return infiniteQueryOptions({
    queryKey: feedKeys.list(),
    queryFn: ({ pageParam }) =>
      listFeedPosts(pageParam, readPostViewMode() === "card"),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: FeedPage) => lastPage.nextPageToken,
    staleTime: FEED_STALE_TIME,
    // 무한 쿼리의 리페치는 쌓아 둔 페이지를 전부 다시 읽는다. 10페이지까지 내려간 사용자가
    // 15초 뒤 돌아왔다고 열 번 왕복시킬 이유는 없다. 시간 기반 갱신 대신 명시적 갱신만
    // 쓴다 — 랭킹 피드는 보고 있는 사이 조용히 재배열되지 않는 편이 낫기도 하다.
    refetchOnMount: false,
  });
}

/**
 * 피드를 처음부터 다시 읽게 만든다. `invalidateQueries`가 아니라 `resetQueries`인 이유는,
 * 무효화는 "쌓인 페이지 전부를 다시 읽어라"가 되지만 여기서 원하는 건 "새 세션을 열어라"이기
 * 때문이다. 다음 접근이 1페이지부터 새 `feedEpoch`로 시작한다.
 */
export function resetFeed(queryClient: QueryClient) {
  return queryClient.resetQueries({ queryKey: feedKeys.all });
}

/**
 * 랭킹을 다시 계산하지 않고 캐시에서 게시물 하나만 뺀다.
 *
 * 삭제는 "이 글이 사라진다"이지 "피드 순서가 바뀐다"가 아니다. 반면 새 세션 하나는
 * `private.create_feed_session()`이 후보를 전부 랭킹해 `feed_session_posts`에 행 단위
 * 루프로 물리화하는 일이라, 글 하나 지우자고 치를 값이 아니다.
 */
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
