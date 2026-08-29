import { ChevronRightIcon, LockIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import type { ProfilePost } from "~/features/posts/model/types";
import { RelativeTime } from "~/shared/components/relative-time";
import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";

/** 작성자 계정이 사라지면 프로필 join이 비어 돌아온다. 자리를 비워 두면 시각만 뜬 카드가 된다. */
export const UNKNOWN_PROFILE_AUTHOR = "알 수 없는 사용자";

export function profilePostAuthorName(post: ProfilePost): string {
  return post.author_name ?? UNKNOWN_PROFILE_AUTHOR;
}

export function profilePostPath(post: ProfilePost): string {
  return `/profile/${post.timeline_pub_id}/posts/${post.post_id}`;
}

/**
 * 개인 게시물의 머리 줄. 카드와 상세가 같은 것을 쓴다.
 *
 * 타인이 남의 타임라인에 쓴 글은 `작성자 ▸ 타임라인 당사자`로 둘을 함께 밝힌다(기능 명세
 * §8.8). 자기 타임라인에 쓴 글은 이름이 한 번만 나온다 — 같은 이름을 두 번 적으면 잡음이다.
 */
export function ProfilePostHeader({
  post,
  align = "start",
  menu,
}: {
  post: ProfilePost;
  align?: "start" | "center";
  menu?: ReactNode;
}) {
  const authorName = profilePostAuthorName(post);
  const onOwnTimeline = post.author_pub_id === post.timeline_pub_id;

  return (
    <header
      className={cn(
        "flex gap-3",
        align === "center" ? "items-center" : "items-start",
      )}
    >
      {post.author_pub_id ? (
        <Link
          to={`/profile/${post.author_pub_id}`}
          aria-label={`${authorName} 프로필`}
        >
          <UserAvatar
            src={post.author_avatar_path}
            name={post.author_name}
            size="lg"
          />
        </Link>
      ) : (
        <UserAvatar src={null} name={null} size="lg" />
      )}

      <div className="min-w-0 flex-1">
        {post.activity_kind ? (
          <div className="flex min-w-0 items-center text-sm text-muted-foreground">
            <ProfileNameLink pubId={post.author_pub_id} name={authorName} />
            <span className="truncate">
              님이{" "}
              {post.activity_kind === "avatar_changed"
                ? "프로필 사진을"
                : "프로필 커버를"}{" "}
              바꾸었습니다.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <ProfileNameLink pubId={post.author_pub_id} name={authorName} />
            {onOwnTimeline ? null : (
              <>
                <ChevronRightIcon
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <ProfileNameLink
                  pubId={post.timeline_pub_id}
                  name={post.timeline_name}
                  label={`${post.timeline_name}님의 타임라인`}
                />
              </>
            )}
            {post.visibility === "private" ? (
              <Badge variant="secondary" className="shrink-0 gap-1">
                <LockIcon className="size-3" aria-hidden="true" />
                비공개
              </Badge>
            ) : null}
          </div>
        )}
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <RelativeTime value={post.published_at} />
        </div>
      </div>

      {menu}
    </header>
  );
}

function ProfileNameLink({
  pubId,
  name,
  label,
}: {
  pubId: string | null;
  name: string;
  label?: string;
}) {
  if (!pubId) {
    return <span className="truncate text-sm font-semibold">{name}</span>;
  }
  return (
    <Link
      to={`/profile/${pubId}`}
      aria-label={label}
      className="truncate text-sm font-semibold hover:underline"
    >
      {name}
    </Link>
  );
}
