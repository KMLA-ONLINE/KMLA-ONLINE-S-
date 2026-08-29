import { startTransition, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import {
  GROUP_CONTENT_STALE_TIME,
  groupKeys,
} from "~/features/groups/data/cache";
import { GroupCategoryChips } from "~/features/posts/components/group-category-chips";
import {
  GroupPostFeed,
  GroupPostFeedEmpty,
} from "~/features/posts/components/group-post-feed";
import {
  hydrateGroupPostMedia,
  listGroupPosts,
} from "~/features/posts/data/queries";
import { usePostViewMode } from "~/features/posts/hooks/use-post-view-mode";
import type {
  GroupCategory,
  GroupPost,
  GroupPostPage,
} from "~/features/posts/model/types";
import { useInfiniteScroll } from "~/shared/hooks/use-infinite-scroll";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";
import { getQueryClient } from "~/shared/lib/query-client";

/**
 * 그룹 게시물 목록.
 *
 * 카테고리 전환과 더 보기는 route를 재검증하지 않고 `data/queries`를 직접 부른다 — 목록을
 * 훑는 동작이라 URL에 남길 이유가 없고, loader를 다시 돌리면 그룹 헤더까지 함께 깜빡인다.
 * 반대로 고정·삭제는 권한과 revalidate가 걸려 있으므로 부모 route의 action으로 보낸다.
 */
export function GroupPostsPanel({
  groupId,
  slug,
  categories,
  initialPage,
}: {
  groupId: string;
  slug: string;
  categories: GroupCategory[];
  initialPage: GroupPostPage;
}) {
  const mutationFetcher = useFetcher<{ error?: string }>();
  const [viewMode] = usePostViewMode();
  const [posts, setPosts] = useState(initialPage.posts);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const loadingMore = useRef(false);
  const hydratedPostIds = useRef(new Set<string>());
  const [loadedInitialPage, setLoadedInitialPage] = useState(initialPage);

  // loader가 새 첫 페이지를 내려주면(고정·삭제 뒤 재검증) 그 페이지는 카테고리를 거치지 않은
  // 전체 목록이다. 칩만 그대로 두면 "공지"를 고른 채 전체 글이 깔린다 — 선택도 함께 되돌린다.
  if (loadedInitialPage !== initialPage) {
    setLoadedInitialPage(initialPage);
    setPosts(initialPage.posts);
    setCursor(initialPage.nextCursor);
    setCategoryId(null);
  }

  useEffect(() => {
    requestId.current += 1;
    hydratedPostIds.current.clear();
  }, [initialPage]);

  useEffect(() => {
    if (viewMode !== "card") return;
    const unhydrated = posts.filter(
      (post) => !hydratedPostIds.current.has(post.post_id),
    );
    if (unhydrated.length === 0) return;
    unhydrated.forEach((post) => hydratedPostIds.current.add(post.post_id));
    void hydrateGroupPostMedia(unhydrated).then((hydrated) => {
      const byId = new Map(hydrated.map((post) => [post.post_id, post]));
      setPosts((current) =>
        current.map((post) => byId.get(post.post_id) ?? post),
      );
    });
  }, [posts, viewMode]);

  const selectCategory = async (nextCategoryId: string | null) => {
    const currentRequest = ++requestId.current;
    setCategoryId(nextCategoryId);
    setCursor(null);
    setLoading(true);
    setError(null);
    try {
      const page = await getQueryClient().fetchQuery({
        queryKey: groupKeys.posts(groupId, nextCategoryId, null),
        queryFn: () =>
          listGroupPosts(groupId, {
            categoryId: nextCategoryId,
            hydrateMedia: viewMode === "card",
          }),
        staleTime: GROUP_CONTENT_STALE_TIME,
      });
      if (currentRequest !== requestId.current) return;
      hydratedPostIds.current.clear();
      startTransition(() => {
        setPosts(page.posts);
        setCursor(page.nextCursor);
      });
    } catch {
      if (currentRequest !== requestId.current) return;
      setError("게시물을 불러오지 못했습니다.");
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!cursor || loadingMore.current) return;
    loadingMore.current = true;
    const currentRequest = requestId.current;
    setLoading(true);
    setError(null);
    try {
      const page = await getQueryClient().fetchQuery({
        queryKey: groupKeys.posts(groupId, categoryId, cursor),
        queryFn: () =>
          listGroupPosts(groupId, {
            categoryId,
            cursor,
            hydrateMedia: viewMode === "card",
          }),
        staleTime: GROUP_CONTENT_STALE_TIME,
      });
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
  const sentinelRef = useInfiniteScroll(() => void loadMore(), {
    enabled: Boolean(cursor) && !error,
    pending: loading,
  });

  const pin = (post: GroupPost) =>
    void mutationFetcher.submit(
      {
        intent: "pin-post",
        groupId,
        postId: post.post_id,
        pinned: String(!post.is_pinned),
      },
      { method: "post" },
    );

  const remove = (post: GroupPost) =>
    void mutationFetcher.submit(
      { intent: "delete-post", groupId, postId: post.post_id },
      { method: "post" },
    );

  return (
    <section aria-label="그룹 게시물" className="flex flex-col gap-3">
      {categories.length > 0 ? (
        <GroupCategoryChips
          categories={categories}
          selected={categoryId}
          onSelect={(next) => void selectCategory(next)}
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

      {loading && posts.length === 0 ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : posts.length === 0 ? (
        <GroupPostFeedEmpty searched={false} />
      ) : (
        <GroupPostFeed
          posts={posts}
          slug={slug}
          viewMode={viewMode}
          onPin={pin}
          onDelete={remove}
        />
      )}

      {cursor && error ? (
        <div className="flex justify-center py-2">
          <Button variant="outline" onClick={() => void loadMore()}>
            다시 시도
          </Button>
        </div>
      ) : null}

      {cursor && loading && posts.length > 0 ? (
        <div
          role="status"
          className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground"
        >
          <Spinner /> 이전 게시물을 불러오는 중입니다.
        </div>
      ) : null}
      <div ref={sentinelRef} className="h-px" aria-hidden="true" />
    </section>
  );
}
