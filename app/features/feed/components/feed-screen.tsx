import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useFetcher, useSearchParams } from "react-router";

import { useAppShell } from "~/features/app-shell";
import {
  FeedPostCard,
  FeedPostRow,
} from "~/features/feed/components/feed-post";
import {
  feedMediaQuery,
  feedQuery,
  resetFeed,
} from "~/features/feed/data/cache";
import { previewFeedPostDetail } from "~/features/feed/model/detail-preview";
import type {
  FeedPost,
  FeedPostDetailResult,
} from "~/features/feed/model/types";
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

  const pages = data?.pages ?? [];
  // 같은 게시물이 두 페이지에 걸쳐 나타날 수 있다(그 사이에 새 글이 올라온 경우).
  const rawPosts = Array.from(
    new Map(
      pages.flatMap((page) => page.posts).map((post) => [post.post_id, post]),
    ).values(),
  );

  const feedEpoch = pages[0]?.feedEpoch ?? null;
  const media = useQuery({
    ...feedMediaQuery(rawPosts, feedEpoch, profile.id),
    enabled: viewMode === "card" && rawPosts.length > 0,
  });
  const hydratedPosts = new Map(
    media.data?.feedEpoch === feedEpoch && media.data.viewerId === profile.id
      ? media.data.posts.map((post) => [post.post_id, post])
      : [],
  );
  /** 수화는 URL만 채운다. 늦은 응답이 본문·첨부·engagement를 되돌리지 않는다. */
  const posts = rawPosts.map((post): FeedPost => {
    const hydrated = hydratedPosts.get(post.post_id);
    if (!hydrated) return post;
    const urls = {
      author_avatar_url:
        post.author_avatar_path === hydrated.author_avatar_path
          ? hydrated.author_avatar_url
          : post.author_avatar_url,
      attachments: post.attachments.map((attachment) => {
        const signed = hydrated.attachments.find(
          (item) =>
            item.attachment_id === attachment.attachment_id &&
            item.storage_bucket === attachment.storage_bucket,
        );
        return {
          ...attachment,
          signedUrl:
            signed?.object_path === attachment.object_path
              ? signed.signedUrl
              : attachment.signedUrl,
          thumbnailUrl:
            signed?.thumbnail_path === attachment.thumbnail_path
              ? (signed?.thumbnailUrl ?? null)
              : attachment.thumbnailUrl,
        };
      }),
    };
    if (post.kind === "group") return { ...post, ...urls };
    return {
      ...post,
      ...urls,
      activity_media_url:
        post.activity_media_path === hydrated.activity_media_path
          ? hydrated.activity_media_url
          : post.activity_media_url,
    };
  });
  const missingMedia = posts.some(
    (post) =>
      Boolean(post.author_avatar_path && !post.author_avatar_url) ||
      Boolean(post.activity_media_path && !post.activity_media_url) ||
      post.attachments.some((item) => !item.signedUrl),
  );

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
              mediaPending={media.isPending || media.isFetching}
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

      {viewMode === "card" && missingMedia && !media.isFetching ? (
        <div className="flex justify-center px-4 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void media.refetch()}
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
          identities={identities}
          anonymousActivityRestriction={restrictionQuery.data}
          comments={detail.comments}
          viewer={{ name: profile.name, avatarUrl: profile.avatar_url }}
          onClose={closeDetail}
          action={groupPostPath(detail.slug, detail.post.post_id)}
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
