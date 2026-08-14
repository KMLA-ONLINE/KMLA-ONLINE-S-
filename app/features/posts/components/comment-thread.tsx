import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import {
  CommentItem,
  commentDomId,
} from "~/features/posts/components/comment-item";
import type { PostComment } from "~/features/posts/model/types";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";

/** 답글 최대 중첩 단계(기능 명세 §9.2). 이 깊이에 닿은 댓글에는 답글 버튼을 두지 않는다. */
const MAX_REPLY_DEPTH = 10;

const HIGHLIGHT_MS = 1600;

export function CommentThread({
  comments,
  replies,
  expanded,
  hasOlder,
  loading,
  pending,
  scrollRef,
  onLoadOlder,
  onToggleReplies,
  onReply,
  onEdit,
  onDelete,
}: {
  comments: PostComment[];
  replies: Record<string, PostComment[]>;
  expanded: ReadonlySet<string>;
  hasOlder: boolean;
  loading: boolean;
  pending: boolean;
  /** 상세 모달의 스크롤 영역. 이전 댓글을 위에 붙일 때 위치를 보정한다. */
  scrollRef?: RefObject<HTMLElement | null>;
  onLoadOlder: () => void | Promise<unknown>;
  onToggleReplies: (rootId: string) => void | Promise<unknown>;
  onReply: (comment: PostComment) => void;
  onEdit: (comment: PostComment, body: string) => void | Promise<unknown>;
  onDelete: (comment: PostComment) => void | Promise<unknown>;
}) {
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(highlightTimer.current), []);

  const jumpTo = (commentId: string) => {
    document
      .getElementById(commentDomId(commentId))
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlighted(commentId);
    clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(
      () => setHighlighted(null),
      HIGHLIGHT_MS,
    );
  };

  /**
   * 이전 댓글은 목록 위에 붙는다. 그대로 두면 읽고 있던 댓글이 화면 아래로 밀려 내려가므로,
   * 늘어난 높이만큼 스크롤을 내려 보고 있던 위치를 그대로 둔다.
   */
  const loadOlder = async () => {
    const container = scrollRef?.current;
    const before = container?.scrollHeight ?? 0;
    const top = container?.scrollTop ?? 0;
    await onLoadOlder();
    if (!container) return;
    requestAnimationFrame(() => {
      container.scrollTop = top + (container.scrollHeight - before);
    });
  };

  if (comments.length === 0 && !hasOlder) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        <p className="font-semibold text-foreground">아직 댓글이 없습니다</p>
        <p className="mt-1 text-sm">첫 댓글을 남겨 보세요.</p>
      </div>
    );
  }

  return (
    <ul aria-label="댓글" className="flex flex-col py-1">
      {hasOlder ? (
        <li className="flex justify-center py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => void loadOlder()}
          >
            {loading ? <Spinner /> : null} 이전 댓글 더 보기
          </Button>
        </li>
      ) : null}

      {comments.map((comment) => {
        const bundle = replies[comment.comment_id] ?? [];
        const open = expanded.has(comment.comment_id);
        return (
          <li key={comment.comment_id}>
            <ul className="flex flex-col">
              <CommentItem
                comment={comment}
                indent={0}
                canReply
                highlighted={highlighted === comment.comment_id}
                pending={pending}
                onReply={() => onReply(comment)}
                onEdit={(body) => onEdit(comment, body)}
                onDelete={() => void onDelete(comment)}
              />

              {comment.reply_count > 0 ? (
                <li className="pl-11">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2 h-7 text-xs text-muted-foreground"
                    aria-expanded={open}
                    onClick={() => void onToggleReplies(comment.comment_id)}
                  >
                    {open ? (
                      <ChevronUpIcon className="size-3.5" />
                    ) : (
                      <ChevronDownIcon className="size-3.5" />
                    )}
                    답글 {comment.reply_count}개
                  </Button>
                </li>
              ) : null}

              {/*
                3단계 이상도 1단계와 같은 자리에 그린다. 논리적 부모는 `@작성자` 칩이 밝힌다.
                RPC가 스레드 전체를 작성 시각 순으로 내려주므로 대화 순서는 그대로 유지된다.
              */}
              {open
                ? bundle.map((reply) => (
                    <CommentItem
                      key={reply.comment_id}
                      comment={reply}
                      indent={1}
                      canReply={reply.depth < MAX_REPLY_DEPTH}
                      highlighted={highlighted === reply.comment_id}
                      pending={pending}
                      onReply={() => onReply(reply)}
                      onJumpToParent={() =>
                        reply.parent_comment_id &&
                        jumpTo(reply.parent_comment_id)
                      }
                      onEdit={(body) => onEdit(reply, body)}
                      onDelete={() => void onDelete(reply)}
                    />
                  ))
                : null}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
