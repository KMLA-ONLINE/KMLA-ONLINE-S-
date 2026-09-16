import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useFetcher, useSearchParams } from "react-router";

import { useAppShell } from "~/features/app-shell";
import {
  FeedPostCard,
  FeedPostRow,
} from "~/features/feed/components/feed-post";
import {
  feedQuery,
  patchFeedPostCommentCount,
  resetFeed,
} from "~/features/feed/data/cache";
import { patchGroupPostCommentCount } from "~/features/groups";
import { hydrateFeedPostMedia } from "~/features/feed/data/queries";
import type {
  FeedPost,
  FeedPostDetailResult,
} from "~/features/feed/model/types";
import {
  GroupPostDetail,
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

  /**
   * 지금 상세에 걸어 둔 요청. `detailFetcher.data`는 상세를 닫아도 남아 있어서, 같은 글을
   * 다시 열면 "이미 이 글의 데이터가 있다"가 되어 방금 쓴 댓글이 빠진 예전 응답이 그대로
   * 뜬다. 닫을 때 비워 두고, 열 때마다 이 ref로 판단한다.
   *
   * `load`를 거는 순간 기록한다 — 응답을 기다렸다 기록하면 그 사이 effect가 다시 돌아 같은
   * 요청을 두 번 건다. 대신 요청이 끝났는데도 이 글의 응답이 실려 오지 않았으면(중간에
   * 끊긴 요청) 한 번 더 건다. 기록만 하고 끝내면 상세가 열려 있는 내내 다시 걸 길이 없어
   * 사용자는 돌아가는 spinner만 본다. loader가 실패까지 잡아 `error`로 돌려주므로 응답이
   * 아예 없는 경우는 드물고, 그게 이어지더라도 재시도는 한 번으로 묶는다.
   */
  const detailLoad = useRef<{ postId: string; attempts: number } | null>(null);
  const detailFetcherState = useRef(detailFetcher.state);

  useEffect(() => {
    const settled =
      detailFetcherState.current !== "idle" && detailFetcher.state === "idle";
    detailFetcherState.current = detailFetcher.state;

    if (!activePostId) {
      detailLoad.current = null;
      return;
    }
    if (!detailRequest || detailFetcher.state !== "idle") return;

    const current = detailLoad.current;
    if (current?.postId === activePostId) {
      const missing = detailFetcher.data?.requestedPostId !== activePostId;
      if (!settled || !missing || current.attempts >= 2) return;
      detailLoad.current = { postId: activePostId, attempts: 2 };
    } else {
      detailLoad.current = { postId: activePostId, attempts: 1 };
    }
    void detailFetcher.load(detailRequest);
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
  // 미디어 수화본은 만들어진 시점에 멈춰 있다. 그 사이 캐시가 고친 값(댓글 수)까지 되돌리지
  // 않도록, 수화가 채운 필드만 쓰고 수는 언제나 최신 raw post의 것을 얹는다.
  const posts = rawPosts.map((post) => {
    const hydrated = hydratedPosts.get(post.post_id);
    return hydrated ? { ...hydrated, comment_count: post.comment_count } : post;
  });

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

  /**
   * 상세에서 댓글을 쓰거나 지우면 목록의 수도 바로 맞아야 한다. 상세를 닫을 때 route를
   * 재검증하지 않으므로(`docs/DATA_CACHE_POLICY.md` §4) 정본 수를 캐시에 직접 얹는다. 그룹
   * 글은 피드와 그룹 목록 양쪽에 들어 있어 둘 다 고친다.
   */
  const patchCommentCount = (postId: string, commentCount: number) => {
    patchFeedPostCommentCount(queryClient, postId, commentCount);
    const groupId = detail?.kind === "group" ? detail.post.group_id : null;
    if (groupId) {
      patchGroupPostCommentCount(queryClient, groupId, postId, commentCount);
    }
  };

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
        <GroupPostDetail
          slug={detail.slug}
          groupName={detail.groupName}
          post={detail.post}
          identities={detail.identities}
          comments={detail.comments}
          viewer={{ name: profile.name, avatarUrl: profile.avatar_url }}
          onClose={closeDetail}
          onCommentCountChange={patchCommentCount}
          action={`/groups/${detail.slug}/posts/${detail.post.post_id}`}
        />
      ) : null}

      {detail?.kind === "profile" ? (
        <ProfilePostDetail
          post={detail.post}
          comments={detail.comments}
          viewer={{ name: profile.name, avatarUrl: profile.avatar_url }}
          onClose={closeDetail}
          onCommentCountChange={patchCommentCount}
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
