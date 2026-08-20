import { startTransition, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import { PostWriteRow } from "~/features/posts/components/post-write-row";
import { ProfilePostCard } from "~/features/posts/components/profile-post-card";
import { listProfilePosts } from "~/features/posts/data/queries";
import type {
  ProfilePost,
  ProfilePostPage,
} from "~/features/posts/model/types";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";

/**
 * 프로필 타임라인 (기능 명세 §12.4).
 *
 * "더 보기"는 route를 재검증하지 않고 `data/queries`를 직접 부른다 — 목록을 훑는 동작이라
 * URL에 남길 이유가 없고, loader를 다시 돌리면 프로필 머리까지 함께 깜빡인다. 반대로 삭제는
 * 권한과 revalidate가 걸려 있으므로 프로필 route의 action으로 보낸다.
 *
 * 카드/목록 전환과 카테고리 필터는 두지 않는다. 개인 게시물에는 제목도 카테고리도 없어서
 * 목록 보기의 한 줄에 보여줄 것이 본문 앞동아리뿐이다.
 */
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
  const [posts, setPosts] = useState(initialPage.posts);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingMore = useRef(false);
  const requestId = useRef(0);
  const [loadedInitialPage, setLoadedInitialPage] = useState(initialPage);

  // loader가 새 첫 페이지를 내려주면(작성·삭제 뒤 재검증) 더 불러온 페이지는 버린다.
  if (loadedInitialPage !== initialPage) {
    setLoadedInitialPage(initialPage);
    setPosts(initialPage.posts);
    setCursor(initialPage.nextCursor);
  }

  // 재검증이 목록을 처음으로 되돌리면 그 전에 띄운 요청의 결과는 버린다. 그대로 이어 붙이면
  // 방금 지운 게시물이 되살아나거나 새 첫 페이지 위에 옛 뒷장이 얹힌다.
  useEffect(() => {
    requestId.current += 1;
  }, [initialPage]);

  const loadMore = async () => {
    if (!cursor || loadingMore.current) return;
    loadingMore.current = true;
    const currentRequest = requestId.current;
    setLoading(true);
    setError(null);
    try {
      const page = await listProfilePosts(timelinePubId, cursor);
      if (currentRequest !== requestId.current) return;
      startTransition(() => {
        setPosts((current) => [...current, ...page.posts]);
        setCursor(page.nextCursor);
      });
    } catch {
      if (currentRequest !== requestId.current) return;
      setError("이전 게시물을 불러오지 못했습니다.");
    } finally {
      loadingMore.current = false;
      if (currentRequest === requestId.current) setLoading(false);
    }
  };

  const remove = (post: ProfilePost) =>
    void mutationFetcher.submit(
      { intent: "delete-post", postId: post.post_id },
      { method: "post" },
    );

  return (
    <section aria-label="타임라인 게시물" className="flex flex-col gap-2.5">
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

      {cursor ? (
        <div className="flex justify-center py-2">
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => void loadMore()}
          >
            {loading ? <Spinner /> : null} 이전 게시물 더 보기
          </Button>
        </div>
      ) : null}
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
  return (
    <div className="py-16 text-center text-muted-foreground">
      <p className="font-semibold text-foreground">아직 게시물이 없습니다</p>
      <p className="mt-1 text-sm">
        {isOwnTimeline
          ? "첫 게시물을 남겨보세요."
          : canWrite
            ? "가장 먼저 글을 남겨보세요."
            : "이 사용자는 타임라인에 다른 사람의 글을 받지 않습니다."}
      </p>
    </div>
  );
}
