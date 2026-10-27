import { GroupPostCard } from "~/features/posts/components/group/group-post-card";
import { GroupPostRow } from "~/features/posts/components/group/group-post-row";
import { GroupPostSection } from "~/features/posts/components/group/group-post-section";
import { useVisitedPosts } from "~/features/posts/hooks/use-visited-posts";
import type { GroupPost, PostViewMode } from "~/features/posts/model/types";

/**
 * 그룹 게시물 목록. 고정 글은 "고정된 게시물 N개" 묶음으로 감싸 접을 수 있다(기능 명세 §8.7) —
 * 고정이 서너 개 쌓이면 최근 글을 보려고 매번 지나쳐야 했다.
 */
export function GroupPostFeed({
  groupId,
  posts,
  slug,
  viewMode,
  onPin,
  onFeature,
  onMoveFeaturedFront,
  onDelete,
}: {
  groupId: string;
  posts: GroupPost[];
  slug: string;
  viewMode: PostViewMode;
  onPin: (post: GroupPost) => void;
  onFeature: (post: GroupPost) => void;
  onMoveFeaturedFront: (post: GroupPost) => void;
  onDelete: (post: GroupPost) => void;
}) {
  const { visited, markVisited } = useVisitedPosts();

  if (posts.length === 0) return null;

  const pinned = posts.filter((post) => post.is_pinned);
  const rest = posts.filter((post) => !post.is_pinned);

  const renderPosts = (items: GroupPost[]) =>
    viewMode === "list" ? (
      <ul className="flex flex-col divide-y divide-border/70">
        {items.map((post) => (
          <li key={post.post_id}>
            <GroupPostRow
              post={post}
              slug={slug}
              isVisited={visited.has(post.post_id)}
              onVisit={() => markVisited(post.post_id)}
            />
          </li>
        ))}
      </ul>
    ) : (
      <div className="flex flex-col md:gap-3">
        {items.map((post) => (
          <GroupPostCard
            key={post.post_id}
            post={post}
            slug={slug}
            onPin={() => onPin(post)}
            onFeature={() => onFeature(post)}
            onMoveFeaturedFront={() => onMoveFeaturedFront(post)}
            onDelete={() => onDelete(post)}
          />
        ))}
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      {pinned.length > 0 ? (
        <GroupPostSection
          groupId={groupId}
          section="pinned"
          title="고정된 게시물"
          count={pinned.length}
          className="gap-2"
        >
          {renderPosts(pinned)}
        </GroupPostSection>
      ) : null}
      {rest.length > 0 ? renderPosts(rest) : null}
    </div>
  );
}

export function GroupPostFeedEmpty({ searched }: { searched: boolean }) {
  return (
    <div className="py-16 text-center text-muted-foreground">
      <p className="font-semibold text-foreground">
        {searched ? "검색 결과가 없습니다" : "아직 게시물이 없습니다"}
      </p>
      <p className="mt-1 text-sm">
        {searched ? "다른 검색어로 찾아보세요." : "가장 먼저 글을 남겨보세요."}
      </p>
    </div>
  );
}
