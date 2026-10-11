import { HeartIcon, MessageSquareIcon, PinIcon } from "lucide-react";
import { Link } from "react-router";

import { StaffMark } from "~/features/posts/components/staff-mark";
import { ReactionEmoji } from "~/features/posts/components/reaction/reaction-emoji";
import { usePostEngagement } from "~/features/posts/hooks/use-post-engagement";
import { postAuthorName } from "~/features/posts/model/identity";
import { FROM_GROUP, groupPostPath } from "~/features/posts/model/navigation";
import type { GroupPost } from "~/features/posts/model/types";
import { RelativeTime } from "~/shared/components/relative-time";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";

/** 목록 보기의 한 행. 행 전체가 하나의 링크이며, 방문한 게시물은 배경을 낮춘다. */
export function GroupPostRow({
  post,
  slug,
  isVisited,
  onVisit,
}: {
  post: GroupPost;
  slug: string;
  isVisited: boolean;
  onVisit: () => void;
}) {
  const engagement = usePostEngagement(post.post_id, post);

  return (
    <Link
      to={groupPostPath(slug, post.post_id)}
      state={FROM_GROUP}
      onClick={onVisit}
      className={cn(
        "flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
        isVisited && "bg-muted/45 hover:bg-muted/60",
      )}
    >
      <div className="flex items-center gap-2">
        {post.is_pinned ? (
          <PinIcon
            className="size-4 shrink-0 -rotate-45 fill-current text-muted-foreground"
            aria-label="고정됨"
          />
        ) : null}
        {post.category_name ? (
          <Badge
            variant="outline"
            className="shrink-0 font-normal text-muted-foreground"
          >
            {post.category_name}
          </Badge>
        ) : null}
        <p className="line-clamp-1 text-sm font-medium sm:text-base">
          {post.title}
        </p>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="truncate">{postAuthorName(post)}</span>
        {post.author_identity === "staff" ? <StaffMark /> : null}
        {post.is_author && post.author_identity === "anonymous" ? (
          <Badge variant="secondary" className="shrink-0">
            나
          </Badge>
        ) : null}
        <span aria-hidden="true">·</span>
        <RelativeTime value={post.published_at} />
        <span className="ml-auto flex shrink-0 items-center gap-3">
          {/* 행 전체가 링크라 반응은 누를 수 없다. */}
          <span className="flex items-center gap-1">
            {engagement.top_reactions.length > 0 ? (
              engagement.top_reactions.map((reaction) => (
                <ReactionEmoji
                  key={reaction}
                  reaction={reaction}
                  className="text-sm"
                />
              ))
            ) : (
              <HeartIcon className="size-3.5" aria-hidden="true" />
            )}
            <span className="sr-only">반응</span>
            {engagement.reaction_count}
          </span>
          <span className="flex items-center gap-1">
            <MessageSquareIcon className="size-3.5" aria-hidden="true" />
            <span className="sr-only">댓글</span>
            {engagement.comment_count}
          </span>
        </span>
      </div>
    </Link>
  );
}
