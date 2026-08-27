import { useEffect, useRef, useState, type RefObject } from "react";

import type { CommentViewer } from "~/features/posts/components/comment-composer";
import {
  CommentItem,
  commentDomId,
} from "~/features/posts/components/comment-item";
import type {
  CommentImageInput,
  PostComment,
  PostReaction,
} from "~/features/posts/model/types";
import { Spinner } from "~/shared/ui/spinner";

/** 답글 최대 중첩 단계(기능 명세 §9.2). 이 깊이에 닿은 댓글에는 답글 버튼을 두지 않는다. */
const MAX_REPLY_DEPTH = 10;

/**
 * `@작성자` 칩으로 부모 댓글에 옮겨 온 뒤 표시가 남아 있는 시간.
 *
 * 답글 대상 표시는 이 타이머를 쓰지 않는다 — 그쪽은 `replyingToId`가 살아 있는 동안 계속
 * 남아야 한다. 댓글을 쓰는 데 걸리는 시간은 몇 초로 정해 둘 수 있는 것이 아니고, 표시가
 * 먼저 꺼지면 긴 답글을 쓰는 도중 누구에게 답하고 있었는지 화면에서 사라진다.
 */
const HIGHLIGHT_MS = 1600;

export function CommentThread({
  comments,
  replies,
  expanded,
  hasMore,
  loading,
  pending,
  viewer,
  postAuthorPubId,
  replyingToId,
  scrollRef,
  onLoadMore,
  onToggleReplies,
  onReply,
  onEdit,
  onDelete,
  onReact,
}: {
  comments: PostComment[];
  replies: Record<string, PostComment[]>;
  expanded: ReadonlySet<string>;
  hasMore: boolean;
  loading: boolean;
  pending: boolean;
  viewer: CommentViewer;
  /** 게시물 작성자의 `pub_id`. 익명 게시물에서는 없다. */
  postAuthorPubId?: string | null;
  replyingToId?: string | null;
  /** 상세 모달의 스크롤 영역. 부모 댓글 이동 대상을 현재 모달 안으로 제한한다. */
  scrollRef?: RefObject<HTMLElement | null>;
  onLoadMore: () => void | Promise<unknown>;
  onToggleReplies: (rootId: string) => void | Promise<unknown>;
  onReply: (comment: PostComment) => void;
  onEdit: (
    comment: PostComment,
    body: string,
    image?: CommentImageInput,
  ) => void | Promise<unknown>;
  onDelete: (comment: PostComment) => void | Promise<unknown>;
  onReact: (comment: PostComment, next: PostReaction | null) => void;
}) {
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(highlightTimer.current), []);

  /**
   * 이 댓글을 쓴 사람이 게시물 작성자인가.
   *
   * 익명 댓글과 익명 게시물은 RPC가 `author_pub_id`를 지워 내려보내므로 여기서 참이 될 수
   * 없다. 그래도 구멍은 아니다 — 익명 게시물에 글쓴이가 익명으로 단 댓글은 서버가 이미
   * `글쓴이` 라벨로 밝힌다. 비교로 익명이 벗겨지지 않는 것도 같은 이유다.
   */
  const isPostAuthor = (comment: PostComment) =>
    Boolean(postAuthorPubId) && comment.author_pub_id === postAuthorPubId;

  const jumpTo = (commentId: string) => {
    const element = document.getElementById(commentDomId(commentId));
    if (!element) return;

    const container = scrollRef?.current;
    if (container && !container.contains(element)) return;

    if (container) {
      /*
        `scrollIntoView`는 스크롤 조상을 전부 훑고 모바일에서는 visual viewport까지 민다.
        댓글 시트의 높이와 위치가 거기에 묶여 있어서(`use-keyboard-viewport`), 부모 댓글로
        옮겨 왔을 뿐인데 시트가 통째로 끌려온다. 컨테이너 안에서만 움직이면 옮겨 가는 동작은
        그대로고 바깥은 가만히 있는다.
      */
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const toCenter =
        elementRect.top -
        containerRect.top -
        (containerRect.height - elementRect.height) / 2;
      container.scrollTo({
        top: container.scrollTop + toCenter,
        behavior: "smooth",
      });
    } else {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    setHighlighted(commentId);
    clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(
      () => setHighlighted(null),
      HIGHLIGHT_MS,
    );
  };

  if (comments.length === 0 && !hasMore) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        <p className="font-semibold text-foreground">아직 댓글이 없습니다</p>
        <p className="mt-1 text-sm">가장 먼저 댓글을 남겨보세요.</p>
      </div>
    );
  }

  return (
    <ul aria-label="댓글" className="flex flex-col gap-3">
      {comments.map((comment) => {
        const bundle = replies[comment.comment_id] ?? [];
        const open = expanded.has(comment.comment_id);
        return (
          <li key={comment.comment_id}>
            <CommentItem
              comment={comment}
              viewer={viewer}
              canReply
              isPostAuthor={isPostAuthor(comment)}
              replying={replyingToId === comment.comment_id}
              highlighted={highlighted === comment.comment_id}
              pending={pending}
              onReply={() => onReply(comment)}
              onEdit={(body, image) => onEdit(comment, body, image)}
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
            {open && bundle.length > 0 ? (
              <ul
                id={`${commentDomId(comment.comment_id)}-replies`}
                aria-label="답글"
                className="mt-3 flex flex-col gap-3 pl-10"
              >
                {bundle.map((reply) => (
                  <li key={reply.comment_id}>
                    <CommentItem
                      comment={reply}
                      viewer={viewer}
                      canReply={reply.depth < MAX_REPLY_DEPTH}
                      isPostAuthor={isPostAuthor(reply)}
                      replying={replyingToId === reply.comment_id}
                      highlighted={highlighted === reply.comment_id}
                      pending={pending}
                      onReply={() => onReply(reply)}
                      onJumpToParent={() =>
                        reply.parent_comment_id &&
                        jumpTo(reply.parent_comment_id)
                      }
                      onEdit={(body, image) => onEdit(reply, body, image)}
                      onDelete={() => void onDelete(reply)}
                      onReact={(next) => onReact(reply, next)}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}

      {hasMore ? (
        <li className="flex justify-center pt-1">
          <button
            type="button"
            disabled={loading}
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
            onClick={() => void onLoadMore()}
          >
            {loading ? <Spinner className="size-3" /> : null} 댓글 더 보기
          </button>
        </li>
      ) : null}
    </ul>
  );
}
