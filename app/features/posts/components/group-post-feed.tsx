import { GroupPostCard } from "~/features/posts/components/group-post-card";
import { GroupPostRow } from "~/features/posts/components/group-post-row";
import { useVisitedPosts } from "~/features/posts/hooks/use-visited-posts";
import type { GroupPost, PostViewMode } from "~/features/posts/model/types";

/**
 * 카드/목록 두 렌즈로 같은 게시물 배열을 그린다.
 *
 * 모바일에서 카드 사이에 gap이 없는 것은 의도다 — 카드가 화면 좌우에 붙어 있으므로 간격
 * 대신 카드 자신의 아래 테두리가 구분선 역할을 한다. `md:` 이상에서 카드가 떨어져 나오면
 * 그때 간격을 준다.
 */
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
