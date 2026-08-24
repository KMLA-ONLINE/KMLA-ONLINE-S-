import {
  ChevronRightIcon,
  HeartIcon,
  MessageSquareIcon,
  PinIcon,
} from "lucide-react";
import { Link } from "react-router";

import type { FeedPost, GroupFeedPost } from "~/features/feed/model/types";
import { PostActionBar } from "~/features/posts/components/post-action-bar";
import {
  PostFileList,
  PostImageGrid,
  splitPostAttachments,
} from "~/features/posts/components/post-attachments";
import { PostAuthorAvatar } from "~/features/posts/components/post-author-avatar";
import { PostBodyClamp } from "~/features/posts/components/post-body-clamp";
import { PostMarkdown } from "~/features/posts/components/post-markdown";
import { ProfileMediaActivity } from "~/features/posts/components/profile-media-activity";
import { ReactionEmoji } from "~/features/posts/components/reaction-emoji";
import { extractPostPlainText } from "~/features/posts/model/markdown";
import { RelativeTime } from "~/shared/components/relative-time";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";

export function feedPostPath(post: FeedPost): string {
  return post.kind === "group"
    ? `/groups/${post.group_slug}/posts/${post.post_id}`
    : `/profile/${post.timeline_pub_id}/posts/${post.post_id}`;
}

function feedPostOverlayPath(post: FeedPost, comments = false): string {
  const searchParams = new URLSearchParams({
    post: post.post_id,
    kind: post.kind,
    source: post.kind === "group" ? post.group_slug : post.timeline_pub_id,
  });
  if (comments) searchParams.set("view", "comments");
  return `/?${searchParams.toString()}`;
}

function AuthorAvatar({ post }: { post: FeedPost }) {
  const name = post.author_name ?? post.author_label;
  const avatar = (
    <PostAuthorAvatar
      identity={post.author_identity}
      name={post.author_name}
      avatarPath={post.author_avatar_path}
      size="lg"
    />
  );

  if (post.author_identity === "anonymous" || !post.author_pub_id) {
    return avatar;
  }

  return (
    <Link to={`/profile/${post.author_pub_id}`} aria-label={`${name} 프로필`}>
      {avatar}
    </Link>
  );
}

function AuthorName({ post }: { post: FeedPost }) {
  const name = post.author_name ?? post.author_label;

  if (post.author_identity === "anonymous" || !post.author_pub_id) {
    return <span className="truncate text-sm font-semibold">{name}</span>;
  }

  return (
    <Link
      to={`/profile/${post.author_pub_id}`}
      className="truncate text-sm font-semibold hover:underline"
    >
      {name}
    </Link>
  );
}

function FeedPostHeader({ post }: { post: FeedPost }) {
  const ownTimeline =
    post.kind === "profile" && post.author_pub_id === post.timeline_pub_id;
  const activityLabel =
    post.kind === "profile" && post.activity_kind
      ? post.activity_kind === "avatar_changed"
        ? "프로필 사진을 바꾸었습니다."
        : "프로필 커버를 바꾸었습니다."
      : null;

  return (
    <header
      className={cn(
        "flex items-start gap-3 px-4 pb-3",
        post.kind === "group" && post.is_pinned ? "pt-2" : "pt-4",
      )}
    >
      <AuthorAvatar post={post} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <AuthorName post={post} />
          {activityLabel ? (
            <span className="truncate text-sm text-muted-foreground">
              님이 {activityLabel}
            </span>
          ) : post.kind === "profile" && !ownTimeline ? (
            <>
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <Link
                to={`/profile/${post.timeline_pub_id}`}
                className="truncate text-sm font-semibold hover:underline"
              >
                {post.timeline_name}
              </Link>
            </>
          ) : null}
          {!activityLabel && post.author_identity === "staff" ? (
            <Badge variant="outline" className="shrink-0 text-muted-foreground">
              운영진
            </Badge>
          ) : null}
          {!activityLabel &&
          post.is_author &&
          post.author_identity !== "identified" ? (
            <Badge variant="secondary" className="shrink-0">
              나
            </Badge>
          ) : null}
          {!activityLabel && post.kind === "group" && post.category_name ? (
            <Badge variant="secondary" className="shrink-0">
              {post.category_name}
            </Badge>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          {post.kind === "group" ? (
            <>
              <Link
                to={`/groups/${post.group_slug}`}
                className="hover:underline"
              >
                {post.group_name}
              </Link>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <RelativeTime value={post.published_at} />
        </div>
      </div>
    </header>
  );
}

export function FeedPostCard({ post }: { post: FeedPost }) {
  const path = feedPostPath(post);
  const overlayPath = feedPostOverlayPath(post);
  const { images, files } = splitPostAttachments(post.attachments);
  const isMediaActivity = post.kind === "profile" && post.activity_kind;

  return (
    <article className="overflow-hidden border-b-2 border-foreground/20 bg-card shadow-none md:rounded-xl md:border md:border-border md:shadow-sm">
      {post.kind === "group" && post.is_pinned ? (
        <div className="flex items-center gap-1.5 px-4 pt-3 text-xs font-semibold text-muted-foreground">
          <PinIcon className="size-3.5 -rotate-45 fill-current" />
          고정된 게시물
        </div>
      ) : null}
      <FeedPostHeader post={post} />
      {isMediaActivity ? (
        <ProfileMediaActivity post={post} />
      ) : (
        <>
          <div className="px-4">
            {post.kind === "group" ? (
              <h2 className="mb-2 text-xl font-semibold">
                <Link
                  to={overlayPath}
                  preventScrollReset
                  className="hover:underline"
                >
                  {post.title}
                </Link>
              </h2>
            ) : null}
            <PostBodyClamp testId="feed-post-body">
              <PostMarkdown>{post.body}</PostMarkdown>
            </PostBodyClamp>
          </div>
          <PostImageGrid images={images} className="mt-3" />
          {files.length > 0 ? (
            <div className="mt-3 px-4">
              <PostFileList files={files} />
            </div>
          ) : null}
        </>
      )}
      <PostActionBar
        postId={post.post_id}
        reaction={post}
        sharePath={path}
        shareTitle={
          post.kind === "group"
            ? post.title
            : `${post.author_name ?? "사용자"}님의 게시물`
        }
        commentCount={post.comment_count}
        commentTo={feedPostOverlayPath(post, true)}
        className="mt-1"
      />
    </article>
  );
}

function groupListTitle(post: GroupFeedPost) {
  return post.title;
}

export function FeedPostRow({ post }: { post: FeedPost }) {
  const path = feedPostOverlayPath(post);
  const author = post.author_name ?? post.author_label;
  const target = post.kind === "group" ? post.group_name : post.timeline_name;
  const text =
    post.kind === "group"
      ? groupListTitle(post)
      : post.activity_kind
        ? post.activity_kind === "avatar_changed"
          ? "프로필 사진을 바꾸었습니다."
          : "프로필 커버를 바꾸었습니다."
        : extractPostPlainText(post.body);

  return (
    <Link
      to={path}
      preventScrollReset
      className="flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
    >
      <div className="flex items-center gap-2">
        {post.kind === "group" && post.is_pinned ? (
          <PinIcon
            className="size-4 shrink-0 -rotate-45 fill-current text-muted-foreground"
            aria-label="고정됨"
          />
        ) : null}
        {post.kind === "group" && post.category_name ? (
          <Badge
            variant="outline"
            className="shrink-0 font-normal text-muted-foreground"
          >
            {post.category_name}
          </Badge>
        ) : null}
        <p className="line-clamp-1 text-sm font-medium sm:text-base">{text}</p>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="truncate">{author}</span>
        <ChevronRightIcon className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{target}</span>
        <span aria-hidden="true">·</span>
        <RelativeTime value={post.published_at} />
        <span className="ml-auto flex shrink-0 items-center gap-3">
          <span className="flex items-center gap-1">
            {post.top_reactions.length ? (
              post.top_reactions.map((reaction) => (
                <ReactionEmoji key={reaction} reaction={reaction} />
              ))
            ) : (
              <HeartIcon className="size-3.5" aria-hidden="true" />
            )}
            <span className="sr-only">반응</span>
            {post.reaction_count}
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
