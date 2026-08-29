import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useFetcher, useSearchParams } from "react-router";

import { useAppShell } from "~/features/app-shell";
import {
  FeedPostCard,
  FeedPostRow,
} from "~/features/feed/components/feed-post";
import { feedQuery, resetFeed } from "~/features/feed/data/cache";
import { hydrateFeedPostMedia } from "~/features/feed/data/queries";
import type {
  FeedPost,
  FeedPostDetailResult,
} from "~/features/feed/model/types";
import {
  GroupPostOverlay,
  ProfilePostDetail,
  usePostViewMode,
  useVisitedPosts,
} from "~/features/posts";
import { useInfiniteScroll } from "~/shared/hooks/use-infinite-scroll";
import { useModalClose } from "~/shared/hooks/use-modal-close";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";

export function FeedScreen() {
  const detailFetcher = useFetcher<FeedPostDetailResult>();
  const queryClient = useQueryClient();
  const { profile } = useAppShell();
  const [searchParams] = useSearchParams();
  const [viewMode] = usePostViewMode();
  const { visited, markVisited } = useVisitedPosts();
  const closeDetail = useModalClose("/");
  const activePostId = searchParams.get("post");
  const activeKind = searchParams.get("kind");
  const activeSource = searchParams.get("source");
  const detailRequest =
    activePostId &&
    (activeKind === "group" || activeKind === "profile") &&
    activeSource
      ? `/feed/posts/${activePostId}?kind=${activeKind}&source=${encodeURIComponent(activeSource)}`
      : null;

  /**
   * 로더가 이미 첫 페이지를 캐시에 채워 두므로 첫 렌더는 동기적으로 데이터를 얻는다.
   * 페이지 누적은 캐시가 소유한다 — 예전에는 이걸 컴포넌트 state가 들고 있어서, 화면을
   * 벗어나면 캐시에 남아 있는 2~N페이지를 두고도 1페이지부터 다시 시작했다.
   */
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isRefetching,
  } = useInfiniteQuery(feedQuery());

  useEffect(() => {
    if (
      detailRequest &&
      detailFetcher.state === "idle" &&
      detailFetcher.data?.requestedPostId !== activePostId
    ) {
      void detailFetcher.load(detailRequest);
    }
  }, [activePostId, detailFetcher, detailRequest]);

  const pages = data?.pages ?? [];
  // 같은 게시물이 두 페이지에 걸쳐 나타날 수 있다(그 사이에 새 글이 올라온 경우).
  const rawPosts = Array.from(
    new Map(
      pages.flatMap((page) => page.posts).map((post) => [post.post_id, post]),
    ).values(),
  );

  const feedEpoch = pages[0]?.feedEpoch ?? null;
  const hydratedPostIds = useRef(new Set<string>());
  const [hydratedState, setHydratedState] = useState(() => ({
    feedEpoch,
    posts: new Map<string, FeedPost>(),
  }));
  const hydratedPosts =
    hydratedState.feedEpoch === feedEpoch
      ? hydratedState.posts
      : new Map<string, FeedPost>();
  const posts = rawPosts.map((post) => hydratedPosts.get(post.post_id) ?? post);

  /**
   * 지금 화면에 걸린 세션. 서명이 날아가는 사이 피드가 리셋될 수 있어서, resolve 시점에
   * 클로저의 epoch가 아직 유효한지 이걸로 확인한다.
   */
  const liveFeedEpoch = useRef(feedEpoch);

  // 세션이 바뀌면 이전 세션에서 채운 미디어는 버린다.
  useEffect(() => {
    liveFeedEpoch.current = feedEpoch;
    hydratedPostIds.current.clear();
  }, [feedEpoch]);

  useEffect(() => {
    if (viewMode !== "card") return;
    const unhydrated = rawPosts.filter(
      (post) => !hydratedPostIds.current.has(post.post_id),
    );
    if (unhydrated.length === 0) return;
    unhydrated.forEach((post) => hydratedPostIds.current.add(post.post_id));
    void hydrateFeedPostMedia(unhydrated).then((hydrated) => {
      // 이 결과는 이미 지나간 세션의 것이다. 지금 세션이 채워 둔 걸 덮어쓰면, 그 글들은
      // `hydratedPostIds`에 이미 올라가 있어 다시 시도되지도 않는다.
      if (liveFeedEpoch.current !== feedEpoch) return;

      setHydratedState((current) => {
        const next =
          current.feedEpoch === feedEpoch
            ? new Map(current.posts)
            : new Map<string, FeedPost>();
        hydrated.forEach((post) => next.set(post.post_id, post));
        return { feedEpoch, posts: next };
      });
    });
  }, [feedEpoch, rawPosts, viewMode]);

  const pending = isFetchingNextPage || isRefetching;
  const activeDetailResult =
    activePostId && detailFetcher.data?.requestedPostId === activePostId
      ? detailFetcher.data
      : null;
  const detail = activeDetailResult?.detail ?? null;

  function loadMore() {
    if (!hasNextPage || pending) return;
    void fetchNextPage();
  }

  const sentinelRef = useInfiniteScroll(loadMore, {
    enabled: hasNextPage && !error,
    pending,
  });

  const loadError = error
    ? error.message || "피드를 불러오지 못했습니다."
    : null;
  // 만료된 토큰으로는 이어 읽을 수 없다. 세션을 새로 열어야 한다.
  const sessionExpired = Boolean(
    error && /expired|not found/i.test(error.message),
  );

  // `resetQueries`가 활성 observer를 곧바로 다시 읽으므로 별도 refetch가 필요 없다.
  async function refresh() {
    await resetFeed(queryClient);
  }

  return (
    <section className="flex min-w-0 flex-col">
      {viewMode === "card" ? (
        <div className="flex flex-col md:gap-3">
          {posts.map((post) => (
            <FeedPostCard key={post.post_id} post={post} />
          ))}
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border/70 bg-card md:rounded-xl md:border">
          {posts.map((post) => (
            <li key={post.post_id}>
              <FeedPostRow
                post={post}
                isVisited={visited.has(post.post_id)}
                onVisit={() => markVisited(post.post_id)}
              />
            </li>
          ))}
        </ul>
      )}

      {posts.length === 0 && !loadError ? (
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">
          아직 게시물이 없습니다.
        </p>
      ) : null}

      {loadError ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={
              pages.length > 0 && !sessionExpired
                ? loadMore
                : () => void refresh()
            }
          >
            {pages.length > 0 && !sessionExpired ? "다시 시도" : "새로고침"}
          </Button>
        </div>
      ) : null}

      {pending ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          게시물을 불러오는 중입니다.
        </p>
      ) : null}
      <div ref={sentinelRef} className="h-px" aria-hidden="true" />

      {detail?.kind === "group" ? (
        <GroupPostOverlay
          mode="detail"
          slug={detail.slug}
          groupName={detail.groupName}
          groupId={detail.groupId}
          post={detail.post}
          identities={detail.identities}
          comments={detail.comments}
          viewer={{ name: profile.name, avatarUrl: profile.avatar_url }}
          onClose={closeDetail}
          action={`/groups/${detail.slug}/posts/${detail.post.post_id}`}
        />
      ) : null}

      {detail?.kind === "profile" ? (
        <ProfilePostDetail
          post={detail.post}
          comments={detail.comments}
          viewer={{ name: profile.name, avatarUrl: profile.avatar_url }}
          onClose={closeDetail}
          action={`/profile/${detail.post.timeline_pub_id}/posts/${detail.post.post_id}`}
        />
      ) : null}

      {detailRequest && !detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex min-w-48 flex-col items-center gap-3 rounded-xl bg-background p-5 shadow-xl">
            {activeDetailResult?.error ? (
              <>
                <p role="alert" className="text-sm text-muted-foreground">
                  {activeDetailResult.error}
                </p>
                <Button type="button" variant="outline" onClick={closeDetail}>
                  닫기
                </Button>
              </>
            ) : (
              <>
                <Spinner />
                <p className="text-sm text-muted-foreground">
                  게시물을 불러오는 중입니다.
                </p>
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
