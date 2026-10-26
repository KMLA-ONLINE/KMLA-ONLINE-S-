import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import { PostWriteRow } from "~/features/posts/components/post-write-row";
import { ProfilePostCard } from "~/features/posts/components/profile/profile-post-card";
import { listProfilePosts } from "~/features/posts/data/queries";
import type {
  ProfilePost,
  ProfilePostPage,
} from "~/features/posts/model/types";
import { useInfiniteScroll } from "~/shared/hooks/use-infinite-scroll";
import { useT } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";

/** 프로필 타임라인. "더 보기"는 route 재검증 없이 `data/queries`를 직접 부르고, 삭제는 프로필 route action으로 보낸다. */
export function ProfilePostsPanel({
  timelinePubId,
  canWrite,
  isOwnTimeline,
  viewerName,
  viewerAvatarUrl,
  initialPage,
}: {
  timelinePubId: string;
  /** 타임라인 당사자가 타인 작성을 허용했는가. 끄면 진입줄 자체를 그리지 않는다. */
  canWrite: boolean;
  isOwnTimeline: boolean;
  /** 진입줄 아바타에 쓰는 내 프로필. 남의 타임라인에서도 쓰는 사람은 나다. */
  viewerName: string | null;
  viewerAvatarUrl: string | null;
  initialPage: ProfilePostPage;
}) {
  const mutationFetcher = useFetcher<{ error?: string }>();
  const t = useT();
  const [page, setPage] = useState(initialPage);
  const { posts, nextCursor: cursor } = page;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingMore = useRef(false);
  const requestId = useRef(0);
  const [loadedInitialPage, setLoadedInitialPage] = useState(initialPage);

  // 응답이 아니라 목록·커서·loading이 함께 화면에 반영된 뒤 다음 요청을 허용한다. 응답 직후에
  // 풀면 새 커서가 커밋되기 전 sentinel이 다시 닿아 옛 커서로 같은 페이지를 또 붙인다.
  useEffect(() => {
    if (!loading) loadingMore.current = false;
  }, [loading, posts, cursor]);

  // loader가 새 첫 페이지를 내려주면(작성·삭제 뒤 재검증) 더 불러온 페이지는 버린다.
  if (loadedInitialPage !== initialPage) {
    setLoadedInitialPage(initialPage);
    setPage(initialPage);
    setLoading(false);
    setError(null);
  }

  // 재검증이 목록을 처음으로 되돌리면 그 전에 띄운 요청의 결과는 버린다. 그대로 이어 붙이면
  // 방금 지운 게시물이 되살아나거나 새 첫 페이지 위에 옛 뒷장이 얹힌다.
  useEffect(() => {
    requestId.current += 1;
    loadingMore.current = false;
  }, [initialPage]);

  const loadMore = async () => {
    if (!cursor || loadingMore.current) return;
    loadingMore.current = true;
    const currentRequest = requestId.current;
    setLoading(true);
    setError(null);
    try {
      const next = await listProfilePosts(timelinePubId, cursor);
      if (currentRequest !== requestId.current) return;
      // 페이지 경계에서 겹친 게시물은 다시 붙이지 않는다.
      setPage((current) => {
        const seen = new Set(current.posts.map((post) => post.post_id));
        return {
          posts: [
            ...current.posts,
            ...next.posts.filter((post) => {
              if (seen.has(post.post_id)) return false;
              seen.add(post.post_id);
              return true;
            }),
          ],
          nextCursor: next.nextCursor,
        };
      });
    } catch {
      if (currentRequest !== requestId.current) return;
      setError(t("이전 게시물을 불러오지 못했습니다."));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  };
  const sentinelRef = useInfiniteScroll(() => void loadMore(), {
    enabled: Boolean(cursor) && !error,
    pending: loading,
  });

  const remove = (post: ProfilePost) =>
    void mutationFetcher.submit(
      { intent: "delete-post", postId: post.post_id },
      { method: "post" },
    );

  return (
    <section
      aria-label={t("타임라인 게시물")}
      className="flex flex-col gap-0 sm:gap-2.5"
    >
      {canWrite ? (
        <PostWriteRow
          to={`/profile/${timelinePubId}/posts/new`}
          viewerName={viewerName}
          viewerAvatarUrl={viewerAvatarUrl}
        />
      ) : null}

      {error ? (
        <p role="alert" className="px-4 text-sm text-destructive md:px-0">
          {error}
        </p>
      ) : null}

      {mutationFetcher.data?.error ? (
        <p role="alert" className="px-4 text-sm text-destructive md:px-0">
          {mutationFetcher.data.error}
        </p>
      ) : null}

      {posts.length === 0 ? (
        <ProfileTimelineEmpty
          canWrite={canWrite}
          isOwnTimeline={isOwnTimeline}
        />
      ) : (
        <div className="flex flex-col md:gap-3">
          {posts.map((post) => (
            <ProfilePostCard
              key={post.post_id}
              post={post}
              onDelete={() => remove(post)}
            />
          ))}
        </div>
      )}

      {cursor && error ? (
        <div className="flex justify-center py-2">
          <Button variant="outline" onClick={() => void loadMore()}>
            {t("다시 시도")}
          </Button>
        </div>
      ) : null}

      {cursor && loading ? (
        <div
          role="status"
          className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground"
        >
          <Spinner aria-hidden /> {t("이전 게시물을 불러오는 중입니다.")}
        </div>
      ) : null}
      <div ref={sentinelRef} className="h-px" aria-hidden="true" />
    </section>
  );
}

function ProfileTimelineEmpty({
  canWrite,
  isOwnTimeline,
}: {
  canWrite: boolean;
  isOwnTimeline: boolean;
}) {
  const t = useT();
  return (
    <div className="py-16 text-center text-muted-foreground">
      <p className="font-semibold text-foreground">
        {t("아직 게시물이 없습니다")}
      </p>
      <p className="mt-1 text-sm">
        {isOwnTimeline
          ? t("첫 게시물을 남겨보세요.")
          : canWrite
            ? t("가장 먼저 글을 남겨보세요.")
            : t("이 사용자는 타임라인에 다른 사람의 글을 받지 않습니다.")}
      </p>
    </div>
  );
}
