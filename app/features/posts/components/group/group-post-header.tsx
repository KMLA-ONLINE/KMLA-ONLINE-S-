import type { ReactNode } from "react";
import { Link } from "react-router";

import { PostAuthorAvatar } from "~/features/posts/components/post-author-avatar";
import { StaffMark } from "~/features/posts/components/staff-mark";
import { postAuthorName } from "~/features/posts/model/identity";
import type { GroupPost, GroupPostDetail } from "~/features/posts/model/types";
import { RelativeTime } from "~/shared/components/relative-time";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";

/**
 * 그룹 게시물의 머리 줄. 카드와 상세가 같은 것을 쓴다.
 *
 * 익명 작성자는 프로필로 가는 길을 열지 않는다. 카테고리 badge는 목록에서 글을 가르는
 * 표시라 카드만 켠다(기능 명세 §8.8).
 */
export function GroupPostHeader({
  post,
  align = "start",
  showCategory = false,
  className,
  menu,
}: {
  post: GroupPost | GroupPostDetail;
  align?: "start" | "center";
  showCategory?: boolean;
  className?: string;
  menu?: ReactNode;
}) {
  const authorName = postAuthorName(post);
  const profileTo =
    post.author_identity !== "anonymous" && post.author_pub_id
      ? `/profile/${post.author_pub_id}`
      : null;
  const avatar = (
    <PostAuthorAvatar
      identity={post.author_identity}
      name={post.author_name}
      avatarUrl={post.author_avatar_url}
      size="lg"
    />
  );

  return (
    <header
      className={cn(
        "flex gap-3",
        align === "center" ? "items-center" : "items-start",
        className,
      )}
    >
      {profileTo ? (
        <Link to={profileTo} aria-label={`${authorName} 프로필`}>
          {avatar}
        </Link>
      ) : (
        avatar
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {profileTo ? (
            <Link
              to={profileTo}
              className="truncate text-sm font-semibold hover:underline"
            >
              {authorName}
            </Link>
          ) : (
            <span className="truncate text-sm font-semibold">{authorName}</span>
          )}
          {post.author_identity === "staff" ? <StaffMark /> : null}
          {post.is_author && post.author_identity === "anonymous" ? (
            <Badge variant="secondary" className="shrink-0">
              나
            </Badge>
          ) : null}
          {showCategory && post.category_name ? (
            <Badge variant="secondary" className="shrink-0">
              {post.category_name}
            </Badge>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <RelativeTime value={post.published_at} />
        </div>
      </div>
      {menu}
    </header>
  );
}
