import { useEffect, useState } from "react";
import { useFetcher, useRevalidator, useSearchParams } from "react-router";

import { useAppShell } from "~/features/app-shell";
import {
  FeedPostCard,
  FeedPostRow,
} from "~/features/feed/components/feed-post";
import type {
  FeedPage,
  FeedPageResult,
  FeedPostDetailResult,
} from "~/features/feed/model/types";
import {
  GroupPostOverlay,
  ProfilePostDetail,
  usePostViewMode,
} from "~/features/posts";
import { useInfiniteScroll } from "~/shared/hooks/use-infinite-scroll";
import { useModalClose } from "~/shared/hooks/use-modal-close";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";

export function FeedScreen({
  initialPage,
  initialError,
}: {
  initialPage: FeedPage | null;
  initialError: string | null;
}) {
  const fetcher = useFetcher<FeedPageResult>();
  const detailFetcher = useFetcher<FeedPostDetailResult>();
  const revalidator = useRevalidator();
  const { profile } = useAppShell();
  const [searchParams] = useSearchParams();
  const [viewMode] = usePostViewMode();
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
  const [storedState, setStoredState] = useState<{
    initialPage: FeedPage | null;
    additionalPages: FeedPage[];
    loadError: string | null;
    sessionExpired: boolean;
    processedData: FeedPageResult | null;
  }>({
    initialPage,
    additionalPages: [],
    loadError: initialError,
    sessionExpired: false,
    processedData: null,
  });

  useEffect(() => {
    if (
      detailRequest &&
      detailFetcher.state === "idle" &&
      detailFetcher.data?.requestedPostId !== activePostId
    ) {
      void detailFetcher.load(detailRequest);
    }
  }, [activePostId, detailFetcher, detailRequest]);

  let state = storedState;
  if (state.initialPage !== initialPage) {
    state = {
      initialPage,
      additionalPages: [],
      loadError: initialError,
      sessionExpired: false,
      processedData: null,
    };
    setStoredState(state);
  }

  let pages = [...(initialPage ? [initialPage] : []), ...state.additionalPages];
  let nextPageToken = pages.at(-1)?.nextPageToken ?? null;

  const result = fetcher.data;
  if (result && state.processedData !== result) {
    const nextState = { ...state, processedData: result };

    if (result.pageToken === nextPageToken) {
      if (result.error) {
        nextState.loadError = result.error;
        nextState.sessionExpired = result.expired;
      } else if (
        result.page &&
        result.page.feedEpoch === initialPage?.feedEpoch
      ) {
        nextState.loadError = null;
        nextState.sessionExpired = false;
        nextState.additionalPages = [...state.additionalPages, result.page];
      }
    }

    state = nextState;
    setStoredState(nextState);
    pages = [...(initialPage ? [initialPage] : []), ...state.additionalPages];
    nextPageToken = pages.at(-1)?.nextPageToken ?? null;
  }

  const { loadError, sessionExpired } = state;

  const posts = Array.from(
    new Map(
      pages.flatMap((page) => page.posts).map((post) => [post.post_id, post]),
    ).values(),
  );
  const pending = fetcher.state !== "idle";
  const activeDetailResult =
    activePostId && detailFetcher.data?.requestedPostId === activePostId
      ? detailFetcher.data
      : null;
  const detail = activeDetailResult?.detail ?? null;

  function loadMore() {
    if (!nextPageToken || pending) return;
    setStoredState((current) => ({
      ...current,
      loadError: null,
      sessionExpired: false,
    }));
    void fetcher.load(`/?pageToken=${encodeURIComponent(nextPageToken)}`);
  }

  const sentinelRef = useInfiniteScroll(loadMore, {
    enabled: Boolean(nextPageToken) && !loadError,
    pending,
  });

  function refresh() {
    setStoredState((current) => ({ ...current, loadError: null }));
    void revalidator.revalidate();
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
              <FeedPostRow post={post} />
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
            onClick={initialPage && !sessionExpired ? loadMore : refresh}
          >
            {initialPage && !sessionExpired ? "다시 시도" : "새로고침"}
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
