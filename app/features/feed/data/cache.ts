import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";

import {
  hydrateFeedPostMedia,
  listFeedPosts,
} from "~/features/feed/data/queries";
import type { FeedPage, FeedPost } from "~/features/feed/model/types";

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

/** 목록과 별도 수명으로 서명한다. 같은 버킷의 경로는 공용 서명 배치가 한 요청으로 묶는다. */
export function feedMediaQuery(
  posts: FeedPost[],
  feedEpoch: string | null,
  viewerId: number,
) {
  return queryOptions({
    queryKey: [
      ...feedKeys.all,
      "media",
      viewerId,
      feedEpoch,
      posts.map((post) => [
        post.post_id,
        post.author_avatar_path,
        post.activity_media_path,
        post.attachments.map((item) => [
          item.attachment_id,
          item.storage_bucket,
          item.object_path,
          item.thumbnail_path,
        ]),
      ]),
    ] as const,
    queryFn: async () => ({
      viewerId,
      feedEpoch,
      // 수화 시점의 본문·반응 snapshot은 보관하지 않는다.
      posts: (await hydrateFeedPostMedia(posts)).map((post) => ({
        post_id: post.post_id,
        author_avatar_path: post.author_avatar_path,
        author_avatar_url: post.author_avatar_url,
        activity_media_path: post.activity_media_path,
        activity_media_url: post.activity_media_url,
        attachments: post.attachments.map((item) => ({
          attachment_id: item.attachment_id,
          storage_bucket: item.storage_bucket,
          object_path: item.object_path,
          thumbnail_path: item.thumbnail_path,
          signedUrl: item.signedUrl,
          thumbnailUrl: item.thumbnailUrl,
        })),
      })),
    }),
    // 다음 페이지 서명 중에도 같은 계정·세션의 기존 이미지 URL은 유지한다.
    placeholderData: keepPreviousData,
    // URL의 유효 기간은 공용 서명 캐시가 판단한다. 이 투영 캐시에서 수명을 새로 시작하지 않는다.
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
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
