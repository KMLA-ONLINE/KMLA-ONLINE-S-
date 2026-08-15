import { useEffect, useRef, useState, type RefObject } from "react";

import {
  CommentComposer,
  type CommentViewer,
} from "~/features/posts/components/comment-composer";
import {
  CommentItem,
  commentDomId,
} from "~/features/posts/components/comment-item";
import type {
  PostComment,
  PostIdentity,
  PostReaction,
} from "~/features/posts/model/types";
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
  viewer,
  identities,
  identity,
  onIdentityChange,
  scrollRef,
  onLoadOlder,
  onToggleReplies,
  onSubmitReply,
  onEdit,
  onDelete,
  onReact,
}: {
  comments: PostComment[];
  replies: Record<string, PostComment[]>;
  expanded: ReadonlySet<string>;
  hasOlder: boolean;
  loading: boolean;
  pending: boolean;
  viewer: CommentViewer;
  identities: PostIdentity[];
  identity: PostIdentity;
  onIdentityChange: (next: PostIdentity) => void;
  /** 상세 모달의 스크롤 영역. 이전 댓글을 위에 붙일 때 위치를 보정한다. */
  scrollRef?: RefObject<HTMLElement | null>;
  onLoadOlder: () => void | Promise<unknown>;
  onToggleReplies: (rootId: string) => void | Promise<unknown>;
  onSubmitReply: (parent: PostComment, body: string) => Promise<unknown>;
  onEdit: (comment: PostComment, body: string) => void | Promise<unknown>;
  onDelete: (comment: PostComment) => void | Promise<unknown>;
  onReact: (comment: PostComment, next: PostReaction | null) => void;
}) {
  const [highlighted, setHighlighted] = useState<string | null>(null);
  // 답글 입력창은 한 번에 하나만 연다. 여러 개를 띄우면 어디에 쓰고 있었는지 놓친다.
  const [replyingTo, setReplyingTo] = useState<PostComment | null>(null);
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

  const startReply = (comment: PostComment) => {
    setReplyingTo((current) =>
      current?.comment_id === comment.comment_id ? null : comment,
    );
    // 답글은 묶음 안에 들어가므로, 접혀 있으면 펼쳐야 입력창이 보인다.
    if (!expanded.has(comment.root_comment_id)) {
      void onToggleReplies(comment.root_comment_id);
    }
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

  const replyComposer = (parent: PostComment) => (
    <CommentComposer
      focusOnMount
      className="mt-1"
      viewer={viewer}
      identities={identities}
      identity={identity}
      onIdentityChange={onIdentityChange}
      pending={pending}
      placeholder={`${parent.author_label ?? "익명"}님에게 답글 남기기…`}
      onSubmit={async (body) => {
        const created = await onSubmitReply(parent, body);
        if (created) setReplyingTo(null);
      }}
    />
  );

  if (comments.length === 0 && !hasOlder) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        <p className="font-semibold text-foreground">아직 댓글이 없습니다</p>
        <p className="mt-1 text-sm">가장 먼저 댓글을 남겨보세요.</p>
      </div>
    );
  }

  return (
    <ul aria-label="댓글" className="flex flex-col gap-3">
      {hasOlder ? (
        <li>
          <button
            type="button"
            disabled={loading}
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
            onClick={() => void loadOlder()}
          >
            {loading ? <Spinner className="size-3" /> : null} 이전 댓글 더 보기
          </button>
        </li>
      ) : null}

      {comments.map((comment) => {
        const bundle = replies[comment.comment_id] ?? [];
        const open = expanded.has(comment.comment_id);
        const replyingInThread =
          replyingTo?.root_comment_id === comment.comment_id;
        return (
          <li key={comment.comment_id}>
            <CommentItem
              comment={comment}
              viewer={viewer}
              canReply
              replying={replyingTo?.comment_id === comment.comment_id}
              highlighted={highlighted === comment.comment_id}
              pending={pending}
              onReply={() => startReply(comment)}
              onEdit={(body) => onEdit(comment, body)}
              onDelete={() => void onDelete(comment)}
              onReact={(next) => onReact(comment, next)}
            />

            {comment.reply_count > 0 ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`${commentDomId(comment.comment_id)}-replies`}
                className="mt-2 ml-10 text-xs font-semibold text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => void onToggleReplies(comment.comment_id)}
              >
                {open ? "답글 숨기기" : `답글 ${comment.reply_count}개 보기`}
              </button>
            ) : null}

            {/*
              3단계 이상도 1단계와 같은 자리에 그린다. 논리적 부모는 `@작성자` 칩이 밝힌다.
              RPC가 스레드 전체를 작성 시각 순으로 내려주므로 대화 순서는 그대로 유지된다.
            */}
            {(open && bundle.length > 0) || replyingInThread ? (
              <ul
                id={`${commentDomId(comment.comment_id)}-replies`}
                className="mt-3 flex flex-col gap-3 pl-10"
              >
                {replyingTo?.comment_id === comment.comment_id ? (
                  <li>{replyComposer(comment)}</li>
                ) : null}
                {open
                  ? bundle.map((reply) => (
                      <li key={reply.comment_id}>
                        <CommentItem
                          comment={reply}
                          viewer={viewer}
                          canReply={reply.depth < MAX_REPLY_DEPTH}
                          replying={replyingTo?.comment_id === reply.comment_id}
                          highlighted={highlighted === reply.comment_id}
                          pending={pending}
                          onReply={() => startReply(reply)}
                          onJumpToParent={() =>
                            reply.parent_comment_id &&
                            jumpTo(reply.parent_comment_id)
                          }
                          onEdit={(body) => onEdit(reply, body)}
                          onDelete={() => void onDelete(reply)}
                          onReact={(next) => onReact(reply, next)}
                        />
                        {replyingTo?.comment_id === reply.comment_id
                          ? replyComposer(reply)
                          : null}
                      </li>
                    ))
                  : null}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
