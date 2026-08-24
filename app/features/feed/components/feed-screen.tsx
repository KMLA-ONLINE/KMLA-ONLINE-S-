import { useState } from "react";
import { useFetcher, useRevalidator } from "react-router";

import {
  FeedPostCard,
  FeedPostRow,
} from "~/features/feed/components/feed-post";
import type { FeedPage, FeedPageResult } from "~/features/feed/model/types";
import { usePostViewMode } from "~/features/posts";
import { useInfiniteScroll } from "~/shared/hooks/use-infinite-scroll";
import { Button } from "~/shared/ui/button";

export function FeedScreen({
  initialPage,
  initialError,
}: {
  initialPage: FeedPage | null;
  initialError: string | null;
}) {
  const fetcher = useFetcher<FeedPageResult>();
  const revalidator = useRevalidator();
  const [viewMode] = usePostViewMode();
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
    <section className="flex min-w-0 flex-col py-3 md:py-0">
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
    </section>
  );
}
