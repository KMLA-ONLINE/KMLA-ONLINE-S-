import { startTransition, useState } from "react";
import { useFetcher } from "react-router";

import { GroupCategoryChips } from "~/features/posts/components/group-category-chips";
import {
  GroupPostFeed,
  GroupPostFeedEmpty,
} from "~/features/posts/components/group-post-feed";
import { listGroupPosts } from "~/features/posts/data/queries";
import { usePostViewMode } from "~/features/posts/hooks/use-post-view-mode";
import type {
  GroupCategory,
  GroupPost,
  GroupPostPage,
} from "~/features/posts/model/types";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";

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
  const mutationFetcher = useFetcher();
  const [viewMode] = usePostViewMode();
  const [posts, setPosts] = useState(initialPage.posts);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectCategory = async (nextCategoryId: string | null) => {
    setCategoryId(nextCategoryId);
    setLoading(true);
    setError(null);
    try {
      const page = await listGroupPosts(groupId, {
        categoryId: nextCategoryId,
      });
      startTransition(() => {
        setPosts(page.posts);
        setCursor(page.nextCursor);
      });
    } catch {
      setError("게시물을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await listGroupPosts(groupId, { categoryId, cursor });
      startTransition(() => {
        setPosts((current) => [...current, ...page.posts]);
        setCursor(page.nextCursor);
      });
    } catch {
      setError("이전 게시물을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const pin = (post: GroupPost) =>
    void mutationFetcher.submit(
      {
        intent: "pin-post",
        postId: post.post_id,
        pinned: String(!post.is_pinned),
      },
      { method: "post" },
    );

  const remove = (post: GroupPost) =>
    void mutationFetcher.submit(
      { intent: "delete-post", postId: post.post_id },
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
