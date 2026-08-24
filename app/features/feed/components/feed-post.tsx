import { ChevronRightIcon, HeartIcon, MessageSquareIcon } from "lucide-react";
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
import { Badge } from "~/shared/ui/badge";

export function feedPostPath(post: FeedPost): string {
  return post.kind === "group"
    ? `/groups/${post.group_slug}/posts/${post.post_id}`
    : `/profile/${post.timeline_pub_id}/posts/${post.post_id}`;
}

function Author({ post }: { post: FeedPost }) {
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
    return (
      <div className="contents">
        {avatar}
        <span className="truncate text-sm font-semibold">{name}</span>
      </div>
    );
  }

  return (
    <>
      <Link to={`/profile/${post.author_pub_id}`} aria-label={`${name} 프로필`}>
        {avatar}
      </Link>
      <Link
        to={`/profile/${post.author_pub_id}`}
        className="truncate text-sm font-semibold hover:underline"
      >
        {name}
      </Link>
    </>
  );
}

function FeedPostHeader({ post }: { post: FeedPost }) {
  const ownTimeline =
    post.kind === "profile" && post.author_pub_id === post.timeline_pub_id;

  return (
    <header className="flex items-start gap-3 px-4 pt-4 pb-3">
      <Author post={post} />
      <div className="-ml-2 min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {post.kind === "profile" && !ownTimeline ? (
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
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
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
  const { images, files } = splitPostAttachments(post.attachments);
  const activityLabel =
    post.kind === "profile" && post.activity_kind
      ? post.activity_kind === "avatar_changed"
        ? "프로필 사진을 바꾸었습니다."
        : "프로필 커버를 바꾸었습니다."
      : null;

  return (
    <article className="overflow-hidden border-b-2 border-foreground/20 bg-card shadow-none md:rounded-xl md:border md:border-border md:shadow-sm">
      <FeedPostHeader post={post} />
      {activityLabel ? (
        <>
          <p className="px-4 pb-3 text-sm text-muted-foreground">
            {post.author_name ?? "사용자"}님이 {activityLabel}
          </p>
          <ProfileMediaActivity post={post} />
        </>
      ) : (
        <>
          <div className="px-4">
            {post.kind === "group" ? (
              <div className="mb-2 flex items-center gap-2">
                <h2 className="min-w-0 text-xl font-semibold">
                  <Link to={path} className="hover:underline">
                    {post.title}
                  </Link>
                </h2>
                {post.category_name ? (
                  <Badge variant="secondary">{post.category_name}</Badge>
                ) : null}
              </div>
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
        commentTo={`${path}?view=comments`}
        className="mt-1"
      />
    </article>
  );
}

function groupListTitle(post: GroupFeedPost) {
  return post.title;
}

export function FeedPostRow({ post }: { post: FeedPost }) {
  const path = feedPostPath(post);
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
      className="flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
    >
      <p className="line-clamp-1 text-sm font-medium sm:text-base">{text}</p>
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
