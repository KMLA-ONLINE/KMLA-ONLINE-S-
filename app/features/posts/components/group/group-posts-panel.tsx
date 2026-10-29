import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";

import { GroupCategoryChips } from "~/features/posts/components/group/group-category-chips";
import {
  GroupPostFeed,
  GroupPostFeedEmpty,
} from "~/features/posts/components/group/group-post-feed";
import { GroupPinnedPosts } from "~/features/posts/components/group/group-pinned-posts";
import {
  fetchGroupPosts,
  groupPinnedPostsQuery,
  groupPostsQuery,
  updateGroupPostsData,
} from "~/features/posts/data/cache";
import { hydrateGroupPostMedia } from "~/features/posts/data/queries";
import { usePostViewMode } from "~/features/posts/hooks/use-post-view-mode";
import type {
  GroupCategory,
  GroupPost,
  GroupPostPage,
} from "~/features/posts/model/types";
import { useInfiniteScroll } from "~/shared/hooks/use-infinite-scroll";
import { Button } from "~/shared/ui/button";
import { PostListSkeleton } from "~/features/posts/components/post-card-skeleton";
import { Spinner } from "~/shared/ui/spinner";

/**
 * 그룹 게시물 목록. 카테고리마다 무한 쿼리 하나(`groupPostsQuery`)를 그리고, loader는 전체 목록의 첫
 * 페이지를 데워 둔다. 고정·삭제는 부모 route action으로 보내고 action이 캐시를 고친다.
 */
export function GroupPostsPanel({
  groupId,
  slug,
  categories,
  initialPage,
  pinnedCollapsed,
  onPinnedCollapsedChange,
}: {
  groupId: string;
  slug: string;
  categories: GroupCategory[];
  /** loader가 받은 전체 목록 첫 페이지. 캐시가 비었을 때만 쓴다. */
  initialPage: GroupPostPage;
  pinnedCollapsed: boolean;
  onPinnedCollapsedChange: (collapsed: boolean) => void;
}) {
  // loader가 목록과 함께 받아 둔 고정 목록. 실패했으면 여기서 다시 읽고 섹션 자리에 알린다.
  const queryClient = useQueryClient();
  const pinned = useQuery(groupPinnedPostsQuery(groupId));
  const mutationFetcher = useFetcher<{ error?: string }>();
  const [viewMode] = usePostViewMode();
  const hydrateMedia = viewMode === "card";
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const list = useInfiniteQuery({
    ...groupPostsQuery(groupId, categoryId, hydrateMedia),
    initialData:
      categoryId === null
        ? { pages: [initialPage], pageParams: [null] }
        : undefined,
    // 캐시가 비어 이 값을 쓰는 것은 loader가 받은 뒤 캐시가 지워졌을 때뿐이다. 받은 시각을 모르므로
    // 낡은 것으로 두어 다음 loader가 다시 받게 한다.
    initialDataUpdatedAt: 0,
    // 카테고리를 바꾸는 동안 읽던 목록을 남긴다. 비우면 칩 아래가 빈 화면으로 깜박인다.
    placeholderData: keepPreviousData,
  });
  const pages = list.data?.pages;

  // 목록 보기로 받은 페이지는 카드 보기로 바꿀 때 서명한다. 서명 중에 페이지가 바뀌었으면(다시 받기·
  // 고정·삭제) 그 결과는 버린다. 새 페이지는 이 효과가 다시 맡는다.
  const hydrating = useRef(new WeakSet<GroupPostPage>());
  useEffect(() => {
    if (!hydrateMedia || !pages || list.isPlaceholderData) return;
    const listKey = groupPostsQuery(groupId, categoryId, true).queryKey;
    for (const page of pages) {
      if (page.mediaHydrated || hydrating.current.has(page)) continue;
      hydrating.current.add(page);
      void hydrateGroupPostMedia(page.posts).then(
        (posts) =>
          updateGroupPostsData(queryClient, listKey, (data) => ({
            ...data,
            pages: data.pages.map((current) =>
              current === page
                ? { ...page, posts, mediaHydrated: true }
                : current,
            ),
          })),
        () => hydrating.current.delete(page),
      );
    }
  }, [
    queryClient,
    hydrateMedia,
    pages,
    list.isPlaceholderData,
    groupId,
    categoryId,
  ]);

  // 페이지 경계에서 같은 글이 겹치면(그사이 새 글이 올라와 밀린 경우) 한 번만 그린다.
  const posts = useMemo(() => {
    const seen = new Set<string>();
    return (pages ?? []).flatMap((page) =>
      page.posts.filter((post) => {
        if (seen.has(post.post_id)) return false;
        seen.add(post.post_id);
        return true;
      }),
    );
  }, [pages]);

  const selectCategory = (next: string | null) => {
    // 받아 둔 카테고리 목록이 낡았으면 첫 페이지부터 다시 받는다. 쿼리는 마운트로 다시 읽지 않는다.
    void fetchGroupPosts(queryClient, groupId, next, hydrateMedia).catch(
      () => undefined,
    );
    setCategoryId(next);
  };

  // loader는 전체 목록만 다시 받는다. 글 저장·당겨서 새로고침으로 첫 페이지가 바뀌면 보고 있는 카테고리
  // 목록도 낡았는지 보고 다시 받는다 — 쿼리는 마운트·무효화로 스스로 다시 읽지 않는다.
  const shownInitialPage = useRef(initialPage);
  useEffect(() => {
    if (shownInitialPage.current === initialPage) return;
    shownInitialPage.current = initialPage;
    if (categoryId === null) return;
    void fetchGroupPosts(queryClient, groupId, categoryId, hydrateMedia).catch(
      () => undefined,
    );
  }, [initialPage, queryClient, groupId, categoryId, hydrateMedia]);

  const loadingNext = list.isFetchingNextPage;
  const nextFailed = list.isFetchNextPageError;
  // 기본값은 진행 중인 다음 페이지 요청을 취소하고 다시 보낸다. 관찰자가 연달아 불러도 하나로 합친다.
  const fetchNext = () => void list.fetchNextPage({ cancelRefetch: false });
  const sentinelRef = useInfiniteScroll(fetchNext, {
    enabled: list.hasNextPage && !nextFailed && !list.isPlaceholderData,
    pending: loadingNext,
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

  // 받아 둔 목록을 다시 받다 실패한 것은 알리지 않는다. 읽던 목록이 그대로 있다.
  const firstPageFailed = list.isLoadingError;

  // 목록 보기에는 가로 고정 섹션이 없다. 고정 글은 카테고리와 무관하게 목록 맨 위 행으로 올리고, 시간순
  // 자리에서는 빼 같은 글이 두 번 나오지 않게 한다.
  const listView = viewMode === "list";
  const feedPosts = useMemo(() => {
    if (!listView || !pinned.data?.length) return posts;
    const pinnedIds = new Set(pinned.data.map((post) => post.post_id));
    return [
      ...pinned.data,
      ...posts.filter((post) => !pinnedIds.has(post.post_id)),
    ];
  }, [listView, pinned.data, posts]);

  return (
    <section aria-label="그룹 게시물" className="flex flex-col gap-3">
      <GroupPinnedPosts
        slug={slug}
        // 목록 보기에서는 실패 알림만 이 자리에 남는다.
        posts={listView ? [] : (pinned.data ?? [])}
        failed={pinned.isError}
        onRetry={() => void pinned.refetch()}
        collapsed={pinnedCollapsed}
        onCollapsedChange={onPinnedCollapsedChange}
        onPin={pin}
        onDelete={remove}
      />
      {categories.length > 0 ? (
        <GroupCategoryChips
          categories={categories}
          selected={categoryId}
          onSelect={selectCategory}
        />
      ) : null}

      {firstPageFailed || nextFailed ? (
        <p role="alert" className="px-4 text-sm text-destructive md:px-0">
          {firstPageFailed
            ? "게시물을 불러오지 못했습니다."
            : "이전 게시물을 불러오지 못했습니다."}
        </p>
      ) : null}

      {mutationFetcher.data?.error ? (
        <p role="alert" className="px-4 text-sm text-destructive md:px-0">
          {mutationFetcher.data.error}
        </p>
      ) : null}

      {list.isPending ? (
        <PostListSkeleton />
      ) : feedPosts.length > 0 ? (
        <GroupPostFeed
          posts={feedPosts}
          slug={slug}
          viewMode={viewMode}
          onPin={pin}
          onDelete={remove}
        />
      ) : firstPageFailed ? null : (
        <GroupPostFeedEmpty searched={false} />
      )}

      {firstPageFailed || nextFailed ? (
        <div className="flex justify-center py-2">
          <Button
            variant="outline"
            onClick={() =>
              firstPageFailed ? void list.refetch() : fetchNext()
            }
          >
            다시 시도
          </Button>
        </div>
      ) : null}

      {loadingNext ? (
        <div
          role="status"
          className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground"
        >
          <Spinner aria-hidden /> 이전 게시물을 불러오는 중입니다.
        </div>
      ) : null}
      {/* 페이지가 늘면 sentinel을 새로 붙여 관찰을 다시 건다. 응답이 빨라 요청 중 상태가 한 번도
          그려지지 않으면 관찰이 그대로 남아, 바닥에 머문 sentinel이 다음 페이지를 부르지 않는다. */}
      <div
        key={pages?.length ?? 0}
        ref={sentinelRef}
        className="h-px"
        aria-hidden="true"
      />
    </section>
  );
}
