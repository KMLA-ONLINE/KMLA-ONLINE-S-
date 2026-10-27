import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import {
  GROUP_CONTENT_STALE_TIME,
  groupKeys,
} from "~/features/groups/data/cache";
import { GroupCategoryChips } from "~/features/posts/components/group/group-category-chips";
import { GroupFeaturedPosts } from "~/features/posts/components/group/group-featured-posts";
import {
  GroupPostFeed,
  GroupPostFeedEmpty,
} from "~/features/posts/components/group/group-post-feed";
import {
  hydrateGroupPostMedia,
  listGroupPosts,
} from "~/features/posts/data/queries";
import { usePostViewMode } from "~/features/posts/hooks/use-post-view-mode";
import type {
  GroupCategory,
  GroupPost,
  GroupPostPage,
  PostAttachment,
} from "~/features/posts/model/types";
import { useInfiniteScroll } from "~/shared/hooks/use-infinite-scroll";
import { Button } from "~/shared/ui/button";
import { PostListSkeleton } from "~/features/posts/components/post-card-skeleton";
import { Spinner } from "~/shared/ui/spinner";
import { getQueryClient } from "~/shared/lib/query-client";

/** 그룹 게시물 목록. 카테고리 전환·더 보기는 route 재검증 없이 `data/queries`를 직접 부르고, 고정·삭제는 부모 route action으로 보낸다. */
export function GroupPostsPanel({
  groupId,
  slug,
  categories,
  initialPage,
  featuredPosts = [],
}: {
  groupId: string;
  slug: string;
  categories: GroupCategory[];
  initialPage: GroupPostPage;
  /** 대표 게시물. loader가 서명까지 마쳐 내려준다. */
  featuredPosts?: GroupPost[];
}) {
  const mutationFetcher = useFetcher<{ error?: string }>();
  const [viewMode] = usePostViewMode();
  const [page, setPage] = useState(initialPage);
  const { posts, nextCursor: cursor } = page;
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const loadingMore = useRef(false);
  const hydratedPostIds = useRef(new Set<string>());
  const [loadedInitialPage, setLoadedInitialPage] = useState(initialPage);

  // 응답이 아니라 목록·커서·loading이 함께 화면에 반영된 뒤 다음 요청을 허용한다.
  useEffect(() => {
    if (!loading) loadingMore.current = false;
  }, [loading, posts, cursor]);

  // loader가 새 첫 페이지를 내려주면(고정·삭제 뒤 재검증) 그 페이지는 카테고리를 거치지 않은
  // 전체 목록이다. 칩만 그대로 두면 "공지"를 고른 채 전체 글이 깔린다 — 선택도 함께 되돌린다.
  if (loadedInitialPage !== initialPage) {
    setLoadedInitialPage(initialPage);
    setPage(initialPage);
    setCategoryId(null);
    setLoading(false);
    setError(null);
  }

  useEffect(() => {
    requestId.current += 1;
    loadingMore.current = false;
    hydratedPostIds.current.clear();
  }, [initialPage]);

  useEffect(() => {
    if (viewMode !== "card" || loading) return;
    const currentRequest = requestId.current;
    const unhydrated = posts.filter(
      (post) => !hydratedPostIds.current.has(post.post_id),
    );
    if (unhydrated.length === 0) return;
    unhydrated.forEach((post) => hydratedPostIds.current.add(post.post_id));
    void hydrateGroupPostMedia(unhydrated).then((hydrated) => {
      if (currentRequest !== requestId.current) return;
      const byId = new Map(hydrated.map((post) => [post.post_id, post]));
      setPage((current) => ({
        ...current,
        posts: current.posts.map((post) => {
          const media = byId.get(post.post_id);
          if (!media) return post;
          const signedAttachments: readonly PostAttachment[] =
            media.attachments;
          return {
            ...post,
            author_avatar_url: media.author_avatar_url,
            attachments: post.attachments.map((attachment) => {
              const signed = signedAttachments.find(
                (item) =>
                  item.attachment_id === attachment.attachment_id &&
                  item.object_path === attachment.object_path &&
                  item.thumbnail_path === attachment.thumbnail_path,
              );
              return signed
                ? {
                    ...attachment,
                    signedUrl: signed.signedUrl,
                    thumbnailUrl: signed.thumbnailUrl,
                  }
                : attachment;
            }),
          };
        }),
      }));
    });
  }, [posts, viewMode, loading]);

  const selectCategory = async (nextCategoryId: string | null) => {
    const currentRequest = ++requestId.current;
    hydratedPostIds.current.clear();
    setCategoryId(nextCategoryId);
    setPage((current) => ({ ...current, nextCursor: null }));
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
      setPage(page);
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
      setPage((current) => {
        const seen = new Set(current.posts.map((post) => post.post_id));
        return {
          posts: [
            ...current.posts,
            ...page.posts.filter((post) => {
              if (seen.has(post.post_id)) return false;
              seen.add(post.post_id);
              return true;
            }),
          ],
          nextCursor: page.nextCursor,
        };
      });
    } catch {
      if (currentRequest !== requestId.current) return;
      setError("이전 게시물을 불러오지 못했습니다.");
    } finally {
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

  const feature = (post: GroupPost) =>
    void mutationFetcher.submit(
      {
        intent: "feature-post",
        groupId,
        postId: post.post_id,
        featured: String(!post.is_featured),
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
      <GroupFeaturedPosts
        slug={slug}
        posts={featuredPosts}
        onPin={pin}
        onFeature={feature}
        onDelete={remove}
      />
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
        <PostListSkeleton />
      ) : posts.length === 0 ? (
        <GroupPostFeedEmpty searched={false} />
      ) : (
        <GroupPostFeed
          posts={posts}
          slug={slug}
          viewMode={viewMode}
          onPin={pin}
          onFeature={feature}
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
          <Spinner aria-hidden /> 이전 게시물을 불러오는 중입니다.
        </div>
      ) : null}
      <div ref={sentinelRef} className="h-px" aria-hidden="true" />
    </section>
  );
}
