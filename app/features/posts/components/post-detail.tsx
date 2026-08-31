import { PinIcon } from "lucide-react";
import { useEffect } from "react";
import { Link, useFetcher } from "react-router";

import type { CommentViewer } from "~/features/posts/components/comment-composer";
import {
  PostFileList,
  PostImageGrid,
  splitPostAttachments,
} from "~/features/posts/components/post-attachments";
import { PostAuthorAvatar } from "~/features/posts/components/post-author-avatar";
import { PostDetailDialog } from "~/features/posts/components/post-detail-dialog";
import { PostMarkdown } from "~/features/posts/components/post-markdown";
import { PostMenu } from "~/features/posts/components/post-menu";
import type {
  GroupPostDetail,
  PostCommentPage,
  PostIdentity,
  AnonymousActivityRestriction,
} from "~/features/posts/model/types";
import { useVisitedPosts } from "~/features/posts/hooks/use-visited-posts";
import { RelativeTime } from "~/shared/components/relative-time";
import { useModalClose } from "~/shared/hooks/use-modal-close";
import { Badge } from "~/shared/ui/badge";

export function PostDetail({
  post,
  slug,
  viewer,
  identities,
  comments,
  onClose,
  action,
  anonymousActivityRestriction,
}: {
  post: GroupPostDetail;
  slug: string;
  viewer: CommentViewer;
  /** 이 그룹에서 댓글에 쓸 수 있는 작성 신원. 첫 항목이 기본값이다. */
  identities: PostIdentity[];
  comments: PostCommentPage;
  onClose?: () => void;
  action?: string;
  anonymousActivityRestriction?: AnonymousActivityRestriction | null;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const { markVisited } = useVisitedPosts();
  const defaultClose = useModalClose(`/groups/${slug}`);
  const close = onClose ?? defaultClose;

  const { images, files } = splitPostAttachments(post.attachments);
  const authorName = post.author_name || post.author_label;
  const postPath = `/groups/${slug}/posts/${post.post_id}`;

  useEffect(() => markVisited(post.post_id), [markVisited, post.post_id]);

  const submitIntent = (fields: Record<string, string>) =>
    void fetcher.submit(fields, { method: "post", action });

  return (
    <PostDetailDialog
      title={`${authorName}님의 게시물`}
      postId={post.post_id}
      comments={comments}
      viewer={viewer}
      identities={identities}
      postAuthorPubId={post.author_pub_id}
      error={fetcher.data?.error}
      anonymousActivityRestriction={anonymousActivityRestriction}
      onClose={close}
      actionBar={{
        reaction: {
          reaction_count: post.reaction_count,
          top_reactions: post.top_reactions,
          my_reaction: post.my_reaction,
        },
        sharePath: postPath,
        shareTitle: post.title,
        commentCount: post.comment_count,
      }}
    >
      <div className="flex flex-col gap-3 p-4">
        {post.is_pinned ? (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <PinIcon className="size-3.5 -rotate-45 fill-current" />
            고정된 게시물
          </div>
        ) : null}

        <header className="flex items-center gap-3">
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
                  className="shrink-0 border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                >
                  운영진
                </Badge>
              ) : null}
              {post.is_author && post.author_identity === "anonymous" ? (
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
            <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <RelativeTime value={post.published_at} />
            </div>
          </div>
          <PostMenu
            editTo={`${postPath}/edit`}
            isPinned={post.is_pinned}
            canEdit={post.can_edit}
            canPin={post.can_pin}
            canDelete={post.can_delete}
            canReport={!post.is_author}
            reportPostId={post.post_id}
            canModerateAnonymous={
              post.author_identity === "anonymous" &&
              post.can_moderate_anonymous
            }
            anonymousAuthorRestricted={post.anonymous_author_restricted}
            anonymousAuthorRestrictionExpiresAt={
              post.anonymous_author_restriction_expires_at
            }
            anonymousSourceId={post.post_id}
            onPin={() =>
              submitIntent({
                intent: "pin",
                pinned: String(!post.is_pinned),
              })
            }
            onDelete={() => submitIntent({ intent: "delete" })}
          />
        </header>

        <div>
          <h2 className="mb-2 text-xl font-semibold">{post.title}</h2>
          <PostMarkdown>{post.body}</PostMarkdown>
        </div>

        <PostImageGrid images={images} className="overflow-hidden rounded-lg" />
        <PostFileList files={files} />
      </div>
    </PostDetailDialog>
  );
}
