import { useEffect } from "react";
import { Link, useFetcher, useLocation } from "react-router";

import type { CommentViewer } from "~/features/posts/components/comment/comment-composer";
import {
  PostFileList,
  PostImageGrid,
} from "~/features/posts/components/post-attachments";
import { splitPostAttachments } from "~/features/posts/model/attachments";
import { PostAuthorAvatar } from "~/features/posts/components/post-author-avatar";
import { PostDetailDialog } from "~/features/posts/components/post-detail-dialog";
import { PostMarkdown } from "~/features/posts/components/post-markdown";
import { PostMenu } from "~/features/posts/components/post-menu";
import type {
  GroupPostDetail as GroupPostDetailModel,
  PostCommentPage,
  PostIdentity,
  AnonymousActivityRestriction,
} from "~/features/posts/model/types";
import { isFromGroup } from "~/features/posts/model/navigation";
import { useVisitedPosts } from "~/features/posts/hooks/use-visited-posts";
import { RelativeTime } from "~/shared/components/relative-time";
import { useModalClose } from "~/shared/hooks/use-modal-close";
import { Badge } from "~/shared/ui/badge";

export function GroupPostDetail({
  post,
  slug,
  groupName,
  viewer,
  identities,
  comments,
  onClose,
  action,
  anonymousActivityRestriction,
}: {
  post: GroupPostDetailModel;
  slug: string;
  /** 머리의 그룹 링크에 쓴다. 상세 RPC는 이름을 돌려주지 않아 화면이 들고 있던 값을 받는다. */
  groupName: string;
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
  // 그룹 안에서 들어왔으면 뒤로가기가 이미 그룹을 내놓는다. 피드는 route가 아니라 오버레이라
  // state가 없고, 알림과 공유 링크도 심어 줄 이유가 없어 거기서는 링크가 남는다.
  const fromGroup = isFromGroup(useLocation().state);
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
        {/*
          알림이나 공유 링크로 곧장 들어오면 이 글이 어느 그룹의 것인지 화면에 남는 단서가 없다.
          뒤로가기는 사용자가 온 곳으로 돌려보내야 하므로(`routes/notification-open.tsx`)
          그룹으로 가는 길은 뒤로가기가 아니라 이 링크가 맡는다.

          카테고리와 고정 표시는 여기 두지 않는다(기능 명세 §8.8). 둘 다 목록에서 이 글을
          **찾고 가르는** 표시다 — 카드의 "고정된 게시물"은 왜 맨 위에 있는지를, 카테고리
          badge는 어느 묶음으로 걸러지는지를 말한다. 상세에는 목록이 없어 둘 다 설명할 것이
          없다. 고정 상태는 고정할 수 있는 사용자에게 `PostMenu`의 "고정 해제"로 남는다.
        */}
        {fromGroup ? null : (
          <Link
            to={`/groups/${slug}`}
            className="w-fit max-w-full truncate text-xs font-medium text-muted-foreground hover:underline"
          >
            {groupName} 그룹으로 이동
          </Link>
        )}

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
