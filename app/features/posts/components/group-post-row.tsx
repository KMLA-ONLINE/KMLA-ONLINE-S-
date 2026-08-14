import { HeartIcon, MessageSquareIcon, PinIcon } from "lucide-react";
import { Link } from "react-router";

import type { GroupPost } from "~/features/posts/model/types";
import { RelativeTime } from "~/shared/components/relative-time";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";

/**
 * 목록 보기의 한 행. 제목 중심의 조밀한 줄이고, 행 전체가 하나의 링크다 — 안에 또 다른
 * 클릭 대상을 두면 "어디를 눌러도 열린다"는 목록의 규칙이 깨진다.
 *
 * 방문한 게시물은 배경을 한 단계 낮춰 구분한다(기능 명세 §6.2).
 */
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
  return (
    <Link
      to={`/groups/${slug}/posts/${post.post_id}`}
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
        <span className="truncate">
          {post.author_name || post.author_label}
        </span>
        {post.author_identity === "staff" ? (
          <Badge variant="outline" className="shrink-0 text-muted-foreground">
            운영진
          </Badge>
        ) : null}
        {post.is_author && post.author_identity !== "identified" ? (
          <Badge variant="secondary" className="shrink-0">
            나
          </Badge>
        ) : null}
        <span aria-hidden="true">·</span>
        <RelativeTime value={post.published_at} />
        <span className="ml-auto flex shrink-0 items-center gap-3">
          {/* 반응은 아직 구현 전이라 자리만 잡는다(기능 명세 §8.15). */}
          <span className="flex items-center gap-1">
            <HeartIcon className="size-3.5" aria-hidden="true" />
            <span className="sr-only">반응 (준비 중)</span>0
          </span>
          <span className="flex items-center gap-1">
            <MessageSquareIcon className="size-3.5" aria-hidden="true" />
            <span className="sr-only">댓글</span>
            {post.comment_count}
          </span>
        </span>
      </div>
    </Link>
  );
}
