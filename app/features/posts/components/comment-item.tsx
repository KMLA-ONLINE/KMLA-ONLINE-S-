import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import {
  CommentComposer,
  type CommentViewer,
} from "~/features/posts/components/comment-composer";
import {
  CommentReactionButton,
  CommentReactionSummary,
} from "~/features/posts/components/comment-reaction-button";
import { ReactionListDialog } from "~/features/posts/components/reaction-list-dialog";
import { CommentText } from "~/features/posts/components/comment-text";
import { PostAuthorAvatar } from "~/features/posts/components/post-author-avatar";
import { PostEditedMark } from "~/features/posts/components/post-edited-mark";
import { useCommentReactors } from "~/features/posts/hooks/use-comment-reactors";
import type { PostComment, PostReaction } from "~/features/posts/model/types";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { RelativeTime } from "~/shared/components/relative-time";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";

export function commentDomId(commentId: string): string {
  return `comment-${commentId}`;
}

/**
 * 댓글 한 줄.
 *
 * 이름과 본문을 한 말풍선에 담고 반응·답글·시각은 말풍선 아래 회색 줄에 둔다. 들여쓰기는
 * 목록이 최상위 묶음 단위로 한 번만 준다 — 논리적으로는 10단계까지 중첩되지만(기능 명세 §9.2)
 * 그대로 밀어 넣으면 좁은 화면에서 깊은 답글의 본문 폭이 글자 몇 개로 줄어든다. 대신 부모를
 * 본문 앞 `@작성자` 칩으로 밝히고, 누르면 원래 자리로 이동한다.
 */
export function CommentItem({
  comment,
  viewer,
  canReply,
  replying = false,
  highlighted = false,
  pending = false,
  onReply,
  onReact,
  onJumpToParent,
  onEdit,
  onDelete,
}: {
  comment: PostComment;
  /** 수정 입력창의 아바타에 쓴다. */
  viewer: CommentViewer;
  canReply: boolean;
  replying?: boolean;
  highlighted?: boolean;
  pending?: boolean;
  onReply: () => void;
  onReact: (next: PostReaction | null) => void;
  onJumpToParent?: () => void;
  /** 성공하면 정본 행을 돌려준다. falsy면 수정 입력창을 열어 둔다. */
  onEdit: (body: string) => void | Promise<unknown>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reactorsOpen, setReactorsOpen] = useState(false);
  const reactors = useCommentReactors(comment.comment_id);

  // 삭제된 댓글은 답글이 살아 있는 동안만 자리를 지킨다(없애면 답글 사슬이 끊긴다). 본문과
  // 작성자, 반응과 메뉴는 전부 사라지고 자국만 남는다.
  if (comment.is_deleted) {
    return (
      <div className="flex gap-2">
        <div className="size-8 shrink-0 rounded-full bg-muted/60" aria-hidden />
        <p
          id={commentDomId(comment.comment_id)}
          className={cn(
            "w-fit rounded-2xl bg-muted/60 px-3 py-2 text-sm text-muted-foreground italic transition-shadow",
            highlighted && "ring-2 ring-ring",
          )}
        >
          삭제된 댓글입니다
        </p>
      </div>
    );
  }

  const authorName = comment.author_name || comment.author_label || "익명";
  const linksToProfile =
    comment.author_identity !== "anonymous" && Boolean(comment.author_pub_id);
  const parentLabel = comment.parent_comment_id
    ? comment.parent_author_label
    : null;

  // 수정은 답글 입력창을 그대로 쓴다. 화면에 입력기가 두 종류 있으면 같은 일을 하는데도
  // 다르게 생겨서, 한쪽만 고쳐지는 일이 반복된다. 신원은 작성 뒤 바꿀 수 없으므로 선택지를
  // 원래 신원 하나로 고정해 토글을 감춘다.
  if (editing) {
    return (
      <CommentComposer
        focusOnMount
        className=""
        viewer={viewer}
        identities={[comment.author_identity]}
        identity={comment.author_identity}
        initialValue={comment.body}
        submitLabel="댓글 수정"
        pending={pending}
        onCancel={() => setEditing(false)}
        onSubmit={async (body) => {
          // 저장에 성공했을 때만 닫는다. 먼저 닫으면 실패한 수정본이 입력창과 함께 사라진다.
          const updated = await onEdit(body);
          if (updated) setEditing(false);
          return updated;
        }}
      />
    );
  }

  return (
    <div className="flex gap-2">
      {linksToProfile ? (
        <Link
          to={`/profile/${comment.author_pub_id}`}
          aria-label={`${authorName} 프로필`}
          className="shrink-0"
        >
          <PostAuthorAvatar
            identity={comment.author_identity}
            name={comment.author_name}
            avatarPath={comment.author_avatar_path}
          />
        </Link>
      ) : (
        <PostAuthorAvatar
          identity={comment.author_identity}
          name={comment.author_name}
          avatarPath={comment.author_avatar_path}
          className="shrink-0"
        />
      )}

      <div className="flex min-w-0 flex-1 items-start gap-1">
        <div className="min-w-0 flex-1">
          <div
            id={commentDomId(comment.comment_id)}
            className={cn(
              "w-fit transition-shadow",
              highlighted && "ring-2 ring-ring",
            )}
          >
            <div className="flex items-center gap-1.5">
              {linksToProfile ? (
                <Link
                  to={`/profile/${comment.author_pub_id}`}
                  className="truncate text-xs font-semibold hover:underline"
                >
                  {authorName}
                </Link>
              ) : (
                <p className="truncate text-xs font-semibold">{authorName}</p>
              )}
              {comment.author_identity === "staff" ? (
                <Badge
                  variant="outline"
                  className="shrink-0 text-muted-foreground"
                >
                  운영진
                </Badge>
              ) : null}
              {comment.is_author && comment.author_identity !== "identified" ? (
                <Badge variant="secondary" className="shrink-0">
                  나
                </Badge>
              ) : null}
              <span
                aria-hidden="true"
                className="shrink-0 text-xs text-muted-foreground"
              >
                ·
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs font-normal text-muted-foreground">
                <RelativeTime value={comment.created_at} />
                <PostEditedMark at={comment.edited_at} />
              </span>
            </div>

            <p className="text-sm wrap-break-word whitespace-pre-wrap">
              {parentLabel ? (
                <button
                  type="button"
                  className="mr-1 font-medium text-primary hover:underline"
                  onClick={onJumpToParent}
                >
                  @{parentLabel}
                </button>
              ) : null}
              <CommentText>{comment.body}</CommentText>
            </p>
          </div>

          <div className="my-1 flex items-center gap-3 text-xs text-muted-foreground">
            <CommentReactionButton
              summary={comment}
              onSelect={(reaction) => {
                reactors.invalidate();
                onReact(reaction);
              }}
              onClear={() => {
                reactors.invalidate();
                onReact(null);
              }}
            />
            {canReply ? (
              <button
                type="button"
                aria-expanded={replying}
                className="font-medium hover:underline"
                onClick={onReply}
              >
                답글
              </button>
            ) : null}
            <CommentReactionSummary
              summary={comment}
              onOpen={() => {
                setReactorsOpen(true);
                reactors.load();
              }}
            />
          </div>

          <ReactionListDialog
            open={reactorsOpen}
            onOpenChange={setReactorsOpen}
            reactors={reactors.reactors}
            loading={reactors.loading}
            title="댓글 반응"
          />
        </div>

        {comment.can_edit || comment.can_delete ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="ml-auto shrink-0 text-muted-foreground"
                  aria-label="댓글 옵션"
                />
              }
            >
              <MoreHorizontalIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {comment.can_edit ? (
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  수정
                </DropdownMenuItem>
              ) : null}
              {comment.can_delete ? (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirmingDelete(true)}
                >
                  삭제
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {confirmingDelete ? (
        <ConfirmDialog
          title="댓글을 삭제할까요?"
          description={
            comment.depth === 0 && comment.reply_count > 0
              ? "이 댓글에 달린 답글도 함께 사라집니다."
              : "삭제한 댓글은 되돌릴 수 없습니다."
          }
          confirmLabel="삭제"
          destructive
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false);
            onDelete();
          }}
        />
      ) : null}
    </div>
  );
}
