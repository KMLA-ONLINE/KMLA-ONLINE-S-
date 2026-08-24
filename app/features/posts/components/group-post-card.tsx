import { PinIcon } from "lucide-react";
import { Link } from "react-router";

import { PostActionBar } from "~/features/posts/components/post-action-bar";
import { PostMenu } from "~/features/posts/components/post-menu";
import {
  PostFileList,
  PostImageGrid,
  splitPostAttachments,
} from "~/features/posts/components/post-attachments";
import { PostAuthorAvatar } from "~/features/posts/components/post-author-avatar";
import { PostBodyClamp } from "~/features/posts/components/post-body-clamp";
import { PostMarkdown } from "~/features/posts/components/post-markdown";
import type { GroupPost } from "~/features/posts/model/types";
import { RelativeTime } from "~/shared/components/relative-time";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";

export function GroupPostCard({
  post,
  slug,
  onPin,
  onDelete,
}: {
  post: GroupPost;
  slug: string;
  onPin: () => void;
  onDelete: () => void;
}) {
  const postPath = `/groups/${slug}/posts/${post.post_id}`;
  const { images, files } = splitPostAttachments(post.attachments);
  const authorName = post.author_name || post.author_label;

  return (
    <article className="overflow-hidden border-b-2 border-foreground/20 bg-card shadow-none md:rounded-xl md:border md:border-border md:shadow-sm">
      {post.is_pinned ? (
        <div className="flex items-center gap-1.5 px-4 pt-3 text-xs font-semibold text-muted-foreground">
          <PinIcon className="size-3.5 -rotate-45 fill-current" />
          고정된 게시물
        </div>
      ) : null}

      <header
        className={cn(
          "flex items-start gap-3 px-4 pb-3",
          post.is_pinned ? "pt-2" : "pt-4",
        )}
      >
        {post.author_identity !== "anonymous" && post.author_pub_id ? (
          <Link
            to={`/profile/${post.author_pub_id}`}
            aria-label={`${authorName} 프로필`}
          >
            <PostAuthorAvatar
              identity={post.author_identity}
              name={post.author_name}
              avatarPath={post.author_avatar_path}
              size="lg"
            />
          </Link>
        ) : (
          <PostAuthorAvatar
            identity={post.author_identity}
            name={post.author_name}
            avatarPath={post.author_avatar_path}
            size="lg"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {post.author_identity !== "anonymous" && post.author_pub_id ? (
              <Link
                to={`/profile/${post.author_pub_id}`}
                className="truncate text-sm font-semibold hover:underline"
              >
                {authorName}
              </Link>
            ) : (
              <span className="truncate text-sm font-semibold">
                {authorName}
              </span>
            )}
            {post.author_identity === "staff" ? (
              <Badge
                variant="outline"
                className="shrink-0 text-muted-foreground"
              >
                운영진
              </Badge>
            ) : null}
            {post.is_author && post.author_identity !== "identified" ? (
              <Badge variant="secondary" className="shrink-0">
                나
              </Badge>
            ) : null}
            {post.category_name ? (
              <Badge variant="secondary" className="shrink-0">
                {post.category_name}
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <RelativeTime value={post.published_at} />
          </div>
        </div>
        <PostMenu
          editTo={`${postPath}/edit`}
          isPinned={post.is_pinned}
          canEdit={post.can_edit}
          canPin={post.can_pin}
          canDelete={post.can_delete}
          onPin={onPin}
          onDelete={onDelete}
        />
      </header>

      <div className="px-4">
        {/* 그룹 이름이 h1이므로 게시물 제목은 카드와 상세 모두 h2다. */}
        <h2 className="mb-2 text-xl font-semibold">
          <Link to={postPath} className="hover:underline">
            {post.title}
          </Link>
        </h2>
        <PostBodyClamp testId="group-post-body">
          <PostMarkdown>{post.body}</PostMarkdown>
        </PostBodyClamp>
      </div>

      <PostImageGrid images={images} className="mt-3" />
      {files.length > 0 ? (
        <div className="mt-3 px-4">
          <PostFileList files={files} />
        </div>
      ) : null}

      <PostActionBar
        postId={post.post_id}
        reaction={{
          reaction_count: post.reaction_count,
          top_reactions: post.top_reactions,
          my_reaction: post.my_reaction,
        }}
        sharePath={postPath}
        shareTitle={post.title}
        commentCount={post.comment_count}
        commentTo={`${postPath}?view=comments`}
        className="mt-1"
      />
    </article>
  );
}
