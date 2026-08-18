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
}: {
  post: GroupPostDetail;
  slug: string;
  /** 입력창 왼쪽 아바타에 쓰는 내 프로필. */
  viewer: CommentViewer;
  /** 이 그룹에서 댓글에 쓸 수 있는 작성 신원. 첫 항목이 기본값이다. */
  identities: PostIdentity[];
  comments: PostCommentPage;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const { markVisited } = useVisitedPosts();
  const close = useModalClose(`/groups/${slug}`);

  const { images, files } = splitPostAttachments(post.attachments);
  const authorName = post.author_name || post.author_label;
  const postPath = `/groups/${slug}/posts/${post.post_id}`;

  useEffect(() => markVisited(post.post_id), [markVisited, post.post_id]);

  const submitIntent = (fields: Record<string, string>) =>
    void fetcher.submit(fields, { method: "post" });

  return (
    <PostDetailDialog
      title={`${authorName}님의 게시물`}
      postId={post.post_id}
      comments={comments}
      viewer={viewer}
      identities={identities}
      error={fetcher.data?.error}
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

        {/* 카드와 달리 모달은 콘텐츠에 `p-4` 여백이 있으므로 그리드도 모서리를 둥글린다. */}
        <PostImageGrid images={images} className="overflow-hidden rounded-lg" />
        <PostFileList files={files} />
      </div>
    </PostDetailDialog>
  );
}
