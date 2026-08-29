import { GroupPostCard } from "~/features/posts/components/group-post-card";
import { GroupPostRow } from "~/features/posts/components/group-post-row";
import { useVisitedPosts } from "~/features/posts/hooks/use-visited-posts";
import type { GroupPost, PostViewMode } from "~/features/posts/model/types";

export function GroupPostFeed({
  posts,
  slug,
  viewMode,
  onPin,
  onDelete,
}: {
  posts: GroupPost[];
  slug: string;
  viewMode: PostViewMode;
  onPin: (post: GroupPost) => void;
  onDelete: (post: GroupPost) => void;
}) {
  const { visited, markVisited } = useVisitedPosts();

  if (posts.length === 0) return null;

  if (viewMode === "list") {
    return (
      <ul className="flex flex-col divide-y divide-border/70">
        {posts.map((post) => (
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
    );
  }

  return (
    <div className="flex flex-col md:gap-3">
      {posts.map((post) => (
        <GroupPostCard
          key={post.post_id}
          post={post}
          slug={slug}
          onPin={() => onPin(post)}
          onDelete={() => onDelete(post)}
        />
      ))}
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
