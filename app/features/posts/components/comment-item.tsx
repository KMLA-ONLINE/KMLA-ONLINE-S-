import { CornerUpLeftIcon, MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { CommentText } from "~/features/posts/components/comment-text";
import { PostAuthorAvatar } from "~/features/posts/components/post-author-avatar";
import { PostEditedMark } from "~/features/posts/components/post-edited-mark";
import {
  normalizeCommentBody,
  validateCommentBody,
} from "~/features/posts/model/comment-text";
import type { PostComment } from "~/features/posts/model/types";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { RelativeTime } from "~/shared/components/relative-time";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";
import { Spinner } from "~/shared/ui/spinner";
import { Textarea } from "~/shared/ui/textarea";

export function commentDomId(commentId: string): string {
  return `comment-${commentId}`;
}

/**
 * 댓글 한 줄.
 *
 * 들여쓰기는 최대 한 단계다. 논리적으로는 10단계까지 중첩되지만(기능 명세 §9.2) 그대로 밀어
 * 넣으면 좁은 화면에서 깊은 답글의 본문 폭이 글자 몇 개로 줄어든다. 대신 부모를 `@작성자`
 * 칩으로 밝히고, 누르면 원래 자리로 이동한다.
 */
export function CommentItem({
  comment,
  indent,
  canReply,
  highlighted = false,
  pending = false,
  onReply,
  onJumpToParent,
  onEdit,
  onDelete,
}: {
  comment: PostComment;
  indent: 0 | 1;
  canReply: boolean;
  highlighted?: boolean;
  pending?: boolean;
  onReply: () => void;
  onJumpToParent?: () => void;
  onEdit: (body: string) => void | Promise<unknown>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const indentClass = indent === 1 ? "pl-11" : undefined;

  if (comment.is_deleted) {
    return (
      <li
        id={commentDomId(comment.comment_id)}
        className={cn("px-4 py-2 text-sm text-muted-foreground", indentClass)}
      >
        삭제된 댓글입니다
      </li>
    );
  }

  const authorName = comment.author_name || comment.author_label || "익명";
  const linksToProfile =
    comment.author_identity !== "anonymous" && Boolean(comment.author_pub_id);
  const showsParent = comment.depth >= 2 && Boolean(comment.parent_comment_id);

  const saveEdit = () => {
    const reason = validateCommentBody(draft);
    if (reason) return setEditError(reason);
    setEditError(null);
    setEditing(false);
    void onEdit(normalizeCommentBody(draft));
  };

  return (
    <li
      id={commentDomId(comment.comment_id)}
      className={cn(
        "flex gap-2.5 px-4 py-2 transition-colors",
        indentClass,
        highlighted && "bg-primary/10",
      )}
    >
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
            size="sm"
          />
        </Link>
      ) : (
        <PostAuthorAvatar
          identity={comment.author_identity}
          name={comment.author_name}
          avatarPath={comment.author_avatar_path}
          size="sm"
          className="shrink-0"
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {linksToProfile ? (
            <Link
              to={`/profile/${comment.author_pub_id}`}
              className="truncate text-sm font-semibold hover:underline"
            >
              {authorName}
            </Link>
          ) : (
            <span className="truncate text-sm font-semibold">{authorName}</span>
          )}
          {comment.author_identity === "staff" ? (
            <Badge variant="outline" className="shrink-0 text-muted-foreground">
              운영진
            </Badge>
          ) : null}
          {comment.is_author && comment.author_identity !== "identified" ? (
            <Badge variant="secondary" className="shrink-0">
              나
            </Badge>
          ) : null}
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <RelativeTime value={comment.created_at} />
            <PostEditedMark at={comment.edited_at} />
          </span>
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
                  <DropdownMenuItem
                    onClick={() => {
                      setDraft(comment.body);
                      setEditing(true);
                    }}
                  >
                    수정
                  </DropdownMenuItem>
                ) : null}
                {comment.can_edit && comment.can_delete ? (
                  <DropdownMenuSeparator />
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

        {showsParent ? (
          <button
            type="button"
            onClick={onJumpToParent}
            className="mb-0.5 max-w-full truncate text-xs text-primary hover:underline"
          >
            @
            {comment.parent_is_deleted
              ? "삭제된 댓글"
              : (comment.parent_author_label ?? "알 수 없음")}
          </button>
        ) : null}

        {editing ? (
          <div className="mt-1 grid gap-2">
            <Textarea
              value={draft}
              aria-label="댓글 수정"
              rows={2}
              className="min-h-16 text-sm"
              onChange={(event) => setDraft(event.target.value)}
            />
            {editError ? (
              <p role="alert" className="text-xs text-destructive">
                {editError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setEditError(null);
                }}
              >
                취소
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={saveEdit}
              >
                {pending ? <Spinner /> : null} 저장
              </Button>
            </div>
          </div>
        ) : (
          <CommentText>{comment.body}</CommentText>
        )}

        {canReply && !editing ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-0.5 -ml-2 h-7 text-xs text-muted-foreground"
            onClick={onReply}
          >
            <CornerUpLeftIcon className="size-3.5" /> 답글
          </Button>
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
    </li>
  );
}
