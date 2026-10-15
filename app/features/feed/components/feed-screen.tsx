import {
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useSearchParams } from "react-router";

import { useAppShell } from "~/features/app-shell";
import {
  FeedPostCard,
  FeedPostRow,
} from "~/features/feed/components/feed-post";
import {
  feedPageMediaQueries,
  feedQuery,
  resetFeed,
} from "~/features/feed/data/cache";
import {
  applyFeedMediaUrls,
  type FeedMediaUrls,
  hasMissingMedia,
  missingImagePaths,
} from "~/features/feed/model/media";
import { previewFeedPostDetail } from "~/features/feed/model/detail-preview";
import type { FeedPostDetailResult } from "~/features/feed/model/types";
import {
  anonymousActivityRestrictionQuery,
  GroupPostDetail,
  groupPostPath,
  type PostIdentity,
  ProfilePostDetail,
  resolveIdentityOptions,
  usePostViewMode,
  useVisitedPosts,
} from "~/features/posts";
import { useInfiniteScroll } from "~/shared/hooks/use-infinite-scroll";
import { useModalClose } from "~/shared/hooks/use-modal-close";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";

/** 페이지별 서명 결과를 경로 하나의 표로 모은다. 모듈 함수라 결과가 같으면 같은 참조가 유지된다. */
function combineFeedMedia(results: UseQueryResult<FeedMediaUrls>[]) {
  const urls: FeedMediaUrls = { attachments: {}, profiles: {} };
  for (const { data } of results) {
    if (!data) continue;
    Object.assign(urls.attachments, data.attachments);
    Object.assign(urls.profiles, data.profiles);
  }
  return { urls, fetching: results.map((result) => result.isFetching) };
}

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

  /** 로더가 첫 페이지를 캐시에 채워 두므로 첫 렌더가 동기적이다. 페이지 누적은 캐시가 소유한다. */
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isRefetching,
  } = useInfiniteQuery(feedQuery());

  /**
   * 상세에 걸어 둔 요청. `detailFetcher.data`는 닫아도 남아 옛 응답이 뜨므로 닫을 때 비우고 이 ref로 판단한다.
   * 요청 시점에 기록해 effect 재실행의 중복 요청을 막고, 응답이 안 실려 오면 한 번만 재시도한다.
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

  const pages = data?.pages;
  // 같은 게시물이 두 페이지에 걸쳐 나타날 수 있다(그 사이에 새 글이 올라온 경우).
  const rawPosts = useMemo(
    () =>
      Array.from(
        new Map(
          (pages ?? [])
            .flatMap((page) => page.posts)
            .map((post) => [post.post_id, post]),
        ).values(),
      ),
    [pages],
  );

  const mediaPages = useMemo(
    () => feedPageMediaQueries(queryClient, data, profile.id),
    [data, profile.id, queryClient],
  );
  const media = useQueries({
    queries: mediaPages.map(({ query }) => ({
      ...query,
      enabled: viewMode === "card",
    })),
    combine: combineFeedMedia,
  });
  /** 서명은 URL 필드만 채운다. 늦은 응답이 본문·첨부·engagement를 되돌리지 않는다. */
  const posts = useMemo(
    () => rawPosts.map((post) => applyFeedMediaUrls(post, media.urls)),
    [media.urls, rawPosts],
  );
  // 로딩 표시는 서명이 진행 중인 페이지의, 아직 URL이 없는 게시물에만 붙인다.
  const pendingPostIds = new Set(
    mediaPages.flatMap(({ postIds }, index) =>
      media.fetching[index] ? postIds : [],
    ),
  );
  // 한 번 다시 시도해도 남은 경로는 버튼을 다시 띄우지 않는다. 지워진 객체처럼 재시도로 고칠 수 없는 실패다.
  const [retriedPaths, setRetriedPaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const retryablePaths = posts
    .flatMap(missingImagePaths)
    .filter((path) => !retriedPaths.has(path));
  const canRetryMedia =
    viewMode === "card" &&
    retryablePaths.length > 0 &&
    !media.fetching.some(Boolean);

  function retryMedia() {
    setRetriedPaths((current) => new Set([...current, ...retryablePaths]));
    const targets = new Set(retryablePaths);
    mediaPages.forEach(({ query }) => {
      if (
        query.queryKey[5].attachments.some((path) => targets.has(path)) ||
        query.queryKey[5].profiles.some((path) => targets.has(path))
      ) {
        void queryClient.refetchQueries({
          queryKey: query.queryKey,
          exact: true,
        });
      }
    });
  }

  const pending = isFetchingNextPage || isRefetching;
  const activeDetailResult =
    activePostId && detailFetcher.data?.requestedPostId === activePostId
      ? detailFetcher.data
      : null;
  // 눌린 글은 피드가 이미 들고 있다. 상세 응답을 기다리지 않고 그것으로 창을 열고, 댓글과
  // 권한만 응답이 오면 채운다. 피드에 없는 글(주소로 직접 연 경우)만 아래 로딩 창을 거친다.
  const feedPost = activePostId
    ? posts.find((post) => post.post_id === activePostId)
    : undefined;
  const detail =
    activeDetailResult?.detail ??
    (feedPost && !activeDetailResult?.error
      ? previewFeedPostDetail(feedPost)
      : null);
  const detailGroup = detail?.kind === "group" ? detail.group : null;
  const restrictionQuery = useQuery({
    ...anonymousActivityRestrictionQuery(detailGroup?.groupId ?? ""),
    enabled: detailGroup?.identityPolicy === "optional_anonymous",
  });
  // 그룹 정책을 모르는 미리보기 동안은 언제나 허용되는 실명만 둔다. 입력창은 댓글이 올 때까지 잠겨 있다.
  const identities: PostIdentity[] = detailGroup
    ? resolveIdentityOptions(
        detailGroup.identityPolicy,
        detailGroup.memberRole,
        restrictionQuery.isPending ||
          restrictionQuery.isError ||
          Boolean(restrictionQuery.data),
      )
    : ["identified"];

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
            <FeedPostCard
              key={post.post_id}
              post={post}
              mediaPending={
                pendingPostIds.has(post.post_id) && hasMissingMedia(post)
              }
            />
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

      {canRetryMedia ? (
        <div className="flex justify-center px-4 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={retryMedia}
          >
            이미지 다시 불러오기
          </Button>
        </div>
      ) : null}

      {loadError ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={
              pages && pages.length > 0 && !sessionExpired
                ? loadMore
                : () => void refresh()
            }
          >
            {pages && pages.length > 0 && !sessionExpired
              ? "다시 시도"
              : "새로고침"}
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
          identities={identities}
          anonymousActivityRestriction={restrictionQuery.data}
          comments={detail.comments}
          viewer={{ name: profile.name, avatarUrl: profile.avatar_url }}
          onClose={closeDetail}
          action={groupPostPath(detail.slug, detail.post.post_id)}
          fromFeed
        />
      ) : null}

      {detail?.kind === "profile" ? (
        <ProfilePostDetail
          post={detail.post}
          comments={detail.comments}
          viewer={{ name: profile.name, avatarUrl: profile.avatar_url }}
          onClose={closeDetail}
          action={`/profile/${detail.post.timeline_pub_id}/posts/${detail.post.post_id}`}
          fromFeed
        />
      ) : null}

      {detailRequest && !detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex min-w-48 flex-col items-center gap-3 rounded-xl bg-background p-5 shadow-xl">
            {activeDetailResult?.error ? (
              <p role="alert" className="text-sm text-muted-foreground">
                {activeDetailResult.error}
              </p>
            ) : (
              <>
                <Spinner aria-hidden />
                <p className="text-sm text-muted-foreground">
                  게시물을 불러오는 중입니다.
                </p>
              </>
            )}
            {/* 응답이 안 오면 다른 출구가 없어 불러오는 중에도 닫을 수 있어야 한다. */}
            <Button type="button" variant="outline" onClick={closeDetail}>
              닫기
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
