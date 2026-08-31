import { XIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router";

import {
  CommentComposer,
  type CommentViewer,
} from "~/features/posts/components/comment-composer";
import { CommentThread } from "~/features/posts/components/comment-thread";
import { commentDomId } from "~/features/posts/components/comment-item";
import { PostActionBar } from "~/features/posts/components/post-action-bar";
import { useKeyboardViewport } from "~/features/posts/hooks/use-keyboard-viewport";
import { usePostComments } from "~/features/posts/hooks/use-post-comments";
import { formatPostDate } from "~/features/posts/model/format";
import type {
  PostComment,
  PostCommentPage,
  PostIdentity,
  ReactionSummary,
  AnonymousActivityRestriction,
} from "~/features/posts/model/types";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";

/**
 * 모바일은 전체화면, 데스크톱은 가운데 정렬된 모달.
 *
 * 높이를 `h-[90svh]`로 고정한 것이 핵심이다. 내용에 맞춰 늘어나게 두면 짧은 게시물과 긴
 * 게시물 사이를 오갈 때 모달 크기가 매번 달라져서, 목록에서 하나씩 열어볼 때 창이 계속
 * 출렁인다. `svh`는 모바일 주소창이 접히며 높이가 변하는 것까지 막는다.
 */
const DETAIL_DIALOG_CLASS =
  "flex h-[90svh] flex-col gap-0 overflow-hidden bg-background p-0 ring-0 max-md:top-0 max-md:left-0 max-md:h-svh max-md:max-h-svh max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none md:max-w-2xl";

const COMMENT_SHEET_CLASS =
  "flex h-[90svh] flex-col gap-0 overflow-hidden bg-background p-0 ring-0 max-[1025px]:top-auto max-[1025px]:bottom-0 max-[1025px]:h-[98svh] max-[1025px]:max-h-[98svh] max-[1025px]:rounded-t-2xl max-[1025px]:rounded-b-none max-[1025px]:translate-y-[var(--sheet-drag-offset,0px)] max-[1025px]:data-open:zoom-in-100 max-[1025px]:data-open:slide-in-from-bottom-4 max-[1025px]:data-closed:zoom-out-100 max-[1025px]:data-closed:slide-out-to-bottom-4 max-md:left-0 max-md:max-w-full max-md:translate-x-0 md:max-[1025px]:left-1/2 md:max-[1025px]:max-w-2xl md:max-[1025px]:-translate-x-1/2 min-[1025px]:max-w-2xl";

const DISMISS_DRAG_DISTANCE = 96;
/** 목록에서 시작한 손짓을 당기기로 볼 최소 거리. 그 전에는 브라우저의 스크롤로 둔다. */
const PULL_START_SLOP = 6;
const TABLET_SHEET_QUERY = "(max-width: 1024px) and (hover: none)";

function subscribeToTabletSheetQuery(onChange: () => void) {
  const query = window.matchMedia(TABLET_SHEET_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isTabletSheetViewport() {
  return window.matchMedia(TABLET_SHEET_QUERY).matches;
}

function getServerTabletSheetViewport() {
  return false;
}

/**
 * 그룹 게시물과 개인 게시물 상세가 공유하는 껍데기.
 *
 * 두 상세가 다른 것은 본문 영역뿐이다 — 댓글 목록, 답글, 입력창, 스크롤 컨테이너와 모달
 * 프레이밍은 같다. 액션 바까지 여기서 그리는 이유는 그것이 방금 쓴 댓글을 더한 개수와 입력창
 * 포커스를 필요로 하는데, 둘 다 이 컴포넌트만 알고 있기 때문이다.
 */
export function PostDetailDialog({
  title,
  postId,
  comments,
  viewer,
  identities,
  postAuthorPubId,
  error,
  onClose,
  actionBar,
  children,
  anonymousActivityRestriction,
}: {
  /** 모달 머리에 적는 제목. 낭독기에는 이것이 게시물의 이름이 된다. */
  title: string;
  postId: string;
  comments: PostCommentPage;
  viewer: CommentViewer;
  /** 이 게시물에 댓글로 쓸 수 있는 작성 신원. 첫 항목이 기본값이다. */
  identities: PostIdentity[];
  /** 게시물 작성자의 `pub_id`. 댓글 목록이 작성자 배지를 붙이는 데 쓴다. */
  postAuthorPubId?: string | null;
  error?: string | null;
  onClose: () => void;
  /** 본문 아래 액션 바. 댓글 수는 서버가 준 값만 넘기면 된다 — 방금 쓴 댓글은 여기서 더한다. */
  actionBar: {
    reaction: ReactionSummary;
    sharePath: string;
    shareTitle: string;
    commentCount: number;
  };
  /** 게시물 본문 영역. 종류마다 다른 유일한 부분이다. */
  children: ReactNode;
  anonymousActivityRestriction?: AnonymousActivityRestriction | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * 스크롤 영역은 ref로도 잡고 상태로도 잡는다.
   *
   * 모달 본문은 포털이 나중에 붙여서, 이 컴포넌트의 첫 effect가 도는 시점에는 ref가 아직
   * 비어 있다. 손짓 리스너를 거기에 걸려면 노드가 생겼다는 사실이 effect를 다시 돌게 해야
   * 한다 — ref만으로는 아무 일도 일어나지 않는다.
   */
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const attachList = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setListElement(node);
  }, []);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const thread = usePostComments(postId, comments);
  const [identity, setIdentity] = useState<PostIdentity>(identities[0]);
  const [replyingTo, setReplyingTo] = useState<PostComment | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ pointerId: number; y: number } | null>(null);
  const [searchParams] = useSearchParams();
  const commentsOnly = searchParams.get("view") === "comments";
  const sheetViewport = useSyncExternalStore(
    subscribeToTabletSheetQuery,
    isTabletSheetViewport,
    getServerTabletSheetViewport,
  );
  /**
   * 바텀 시트로 그릴 것인가.
   *
   * 뷰포트만으로 정하면 안 된다 — 게시물을 열었을 뿐인데 본문이 숨겨진 댓글 서랍이 뜬다.
   * 댓글만 보러 들어왔다는 의도(`?view=comments`)가 함께 있어야 한다.
   */
  const commentSheet = commentsOnly && sheetViewport;
  const keyboardViewport = useKeyboardViewport(commentSheet);

  useEffect(() => {
    if (!replyingTo || keyboardViewport.height === null) return;

    const frame = requestAnimationFrame(() => {
      const container = scrollRef.current;
      const target = document.getElementById(
        commentDomId(replyingTo.comment_id),
      );
      if (!container || !target || !container.contains(target)) return;

      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      if (targetRect.top < containerRect.top) {
        container.scrollTop += targetRect.top - containerRect.top;
      } else if (targetRect.bottom > containerRect.bottom) {
        container.scrollTop += targetRect.bottom - containerRect.bottom;
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [keyboardViewport.bottomInset, keyboardViewport.height, replyingTo]);

  // 본문 영역이 액션 바에서 부르는 핸들러다. JSX 안에서 즉석 클로저로 만들면 render 중에
  // ref를 읽는 것으로 잡힌다.
  const focusComposer = useCallback(() => composerRef.current?.focus(), []);

  const startReply = (comment: PostComment) => {
    setReplyingTo(comment);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const submitComment = async (
    body: string,
    image?: Parameters<typeof thread.create>[3],
  ) => {
    const created = await thread.create(body, identity, null, image);
    if (!created) return created;
    // 방금 쓴 댓글은 목록 맨 아래에 붙는다. 보이지 않는 곳에 등록되면 실패로 읽힌다.
    requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
    return created;
  };

  const submit = async (
    body: string,
    image?: Parameters<typeof thread.create>[3],
  ) => {
    if (!replyingTo) return submitComment(body, image);
    const created = await thread.create(
      body,
      identity,
      replyingTo.comment_id,
      image,
    );
    if (created) setReplyingTo(null);
    return created;
  };

  const replyTarget = replyingTo
    ? replyingTo.author_name || replyingTo.author_label || "익명"
    : undefined;

  const startSheetDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!commentSheet) return;
    // 누를 것 위에서 시작한 손짓은 시트가 가로채지 않는다. 96px을 넘겨 시트가 닫히는
    // 순간에도 클릭은 그대로 발생해서, 닫히면서 프로필로 넘어가는 일이 생긴다.
    if ((event.target as Element).closest("a, button")) return;
    dragStart.current = { pointerId: event.pointerId, y: event.clientY };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveSheetDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (start?.pointerId !== event.pointerId) return;
    setDragOffset(Math.max(0, event.clientY - start.y));
  };

  const finishSheetDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (start?.pointerId !== event.pointerId) return;
    const distance = Math.max(0, event.clientY - start.y);
    dragStart.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (distance >= DISMISS_DRAG_DISTANCE) {
      onClose();
      return;
    }
    setDragOffset(0);
  };

  const cancelSheetDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStart.current?.pointerId !== event.pointerId) return;
    dragStart.current = null;
    setDragging(false);
    setDragOffset(0);
  };

  /**
   * 댓글 목록을 맨 위까지 올린 뒤 이어서 아래로 당겨도 시트를 닫는다.
   *
   * 머리글만 끌 수 있으면, 댓글을 다 읽고 목록을 끝까지 올린 사람이 닫으려고 손가락을
   * 위로 다시 가져가야 한다. 이어서 당기는 쪽이 자연스럽다.
   *
   * 포인터 이벤트로는 안 된다. 스크롤 영역 위의 세로 손짓은 브라우저가 스크롤로 가져가면서
   * `pointercancel`로 끊어 버려서, 머리글에서 쓰는 핸들러를 그대로 붙여도 아무 일도 일어나지
   * 않는다. `touchmove`를 passive가 아닌 채로 듣고 직접 `preventDefault`를 불러야 손짓이
   * 우리에게 남는다 — 목록 맨 위에서 아래로 당기기라는 같은 문제를 푸는 `PullToRefresh`가
   * 같은 이유로 같은 방식을 쓴다. 덤으로 `preventDefault`는 뒤따르는 클릭까지 막아 주므로,
   * 링크나 버튼 위에서 당기기 시작해도 닫히면서 그쪽으로 넘어가지 않는다.
   */
  const closeSheet = useEffectEvent(onClose);

  useEffect(() => {
    const container = listElement;
    if (!commentSheet || !container) return;

    let pull: { touchId: number; startY: number; distance: number } | null =
      null;

    const start = (event: TouchEvent) => {
      // 맨 위에 붙어 있을 때만 받는다. 중간에서는 같은 손짓이 스크롤이다.
      if (event.touches.length !== 1 || container.scrollTop > 0) return;
      const touch = event.touches[0];
      pull = { touchId: touch.identifier, startY: touch.clientY, distance: 0 };
    };

    const move = (event: TouchEvent) => {
      if (!pull) return;
      const touch = Array.from(event.touches).find(
        (candidate) => candidate.identifier === pull?.touchId,
      );
      if (!touch) return;

      const distance = touch.clientY - pull.startY;
      // 위로 밀었거나 목록이 다시 내려갔으면 평범한 스크롤이다. 손짓을 브라우저에 돌려준다.
      if (distance <= 0 || container.scrollTop > 0) {
        pull = null;
        setDragging(false);
        setDragOffset(0);
        return;
      }
      if (distance < PULL_START_SLOP) return;

      event.preventDefault();
      pull.distance = distance;
      setDragging(true);
      setDragOffset(distance);
    };

    const finish = () => {
      const distance = pull?.distance ?? 0;
      pull = null;
      if (distance === 0) return;

      setDragging(false);
      if (distance >= DISMISS_DRAG_DISTANCE) {
        closeSheet();
        return;
      }
      setDragOffset(0);
    };

    container.addEventListener("touchstart", start, { passive: true });
    container.addEventListener("touchmove", move, { passive: false });
    container.addEventListener("touchend", finish);
    container.addEventListener("touchcancel", finish);

    return () => {
      container.removeEventListener("touchstart", start);
      container.removeEventListener("touchmove", move);
      container.removeEventListener("touchend", finish);
      container.removeEventListener("touchcancel", finish);
    };
  }, [commentSheet, listElement]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          commentSheet ? COMMENT_SHEET_CLASS : DETAIL_DIALOG_CLASS,
          commentSheet &&
            !dragging &&
            "max-[1025px]:transition-transform max-[1025px]:duration-200",
        )}
        style={
          commentSheet
            ? ({
                bottom:
                  keyboardViewport.bottomInset > 0
                    ? `${keyboardViewport.bottomInset}px`
                    : undefined,
                maxHeight:
                  keyboardViewport.height === null
                    ? undefined
                    : `${keyboardViewport.height}px`,
                "--sheet-drag-offset": `${dragOffset}px`,
              } as CSSProperties)
            : undefined
        }
      >
        <div
          className={cn(
            "shrink-0",
            commentSheet &&
              "max-[1025px]:cursor-grab max-[1025px]:touch-none max-[1025px]:active:cursor-grabbing",
          )}
          onPointerDown={commentSheet ? startSheetDrag : undefined}
          onPointerMove={commentSheet ? moveSheetDrag : undefined}
          onPointerUp={commentSheet ? finishSheetDrag : undefined}
          onPointerCancel={commentSheet ? cancelSheetDrag : undefined}
        >
          {commentSheet ? (
            <div
              aria-hidden="true"
              className="hidden h-5 items-center justify-center max-[1025px]:flex"
            >
              <span className="h-1 w-10 rounded-full bg-muted-foreground/35" />
            </div>
          ) : null}
          <DialogHeader className="relative flex-row items-center justify-center border-b p-3">
            <DialogTitle className="text-base font-semibold">
              {commentSheet ? (
                <>
                  <span className="min-[1025px]:hidden">댓글</span>
                  <span className="max-[1025px]:hidden">{title}</span>
                </>
              ) : (
                title
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">
              게시물 상세와 댓글
            </DialogDescription>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="닫기"
              onClick={onClose}
              className="absolute inset-y-0 right-3 my-auto text-muted-foreground"
            >
              <XIcon />
            </Button>
          </DialogHeader>
        </div>

        <div
          ref={attachList}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            // overscroll-contain: 맨 위에서 더 당길 때 브라우저의 고무줄과 새로고침
            // 제스처가 손짓을 가져가지 않도록 이 영역에 가둔다.
            commentSheet && "overscroll-contain",
          )}
        >
          {error ? (
            <p role="alert" className="border-b p-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <article className={cn(commentSheet && "max-[1025px]:hidden")}>
            {children}

            <PostActionBar
              postId={postId}
              reaction={actionBar.reaction}
              sharePath={actionBar.sharePath}
              shareTitle={actionBar.shareTitle}
              commentCount={actionBar.commentCount + thread.countDelta}
              onComment={focusComposer}
            />
          </article>

          <section className="border-t p-4">
            <CommentThread
              comments={thread.comments}
              replies={thread.replies}
              expanded={thread.expanded}
              hasMore={thread.hasMore}
              loading={thread.loading}
              pending={thread.pending}
              viewer={viewer}
              postAuthorPubId={postAuthorPubId}
              replyingToId={replyingTo?.comment_id}
              scrollRef={scrollRef}
              onLoadMore={thread.loadMore}
              onToggleReplies={thread.toggleReplies}
              onReply={startReply}
              onEdit={thread.edit}
              onReact={thread.react}
              onDelete={thread.remove}
            />
          </section>
        </div>

        {anonymousActivityRestriction ? (
          <p className="border-t px-4 pt-2 text-xs text-muted-foreground">
            익명 활동이 제한되어 있습니다. 사유:{" "}
            {anonymousActivityRestriction.reason}
            {" · "}만료:{" "}
            {formatPostDate(anonymousActivityRestriction.expires_at)}
          </p>
        ) : null}
        <CommentComposer
          viewer={viewer}
          identities={identities}
          identity={identity}
          onIdentityChange={setIdentity}
          onSubmit={submit}
          pending={thread.pending}
          error={thread.error}
          inputRef={composerRef}
          focusOnMount={commentsOnly && !sheetViewport}
          replyTarget={replyTarget}
          onCancelReply={() => setReplyingTo(null)}
        />
      </DialogContent>
    </Dialog>
  );
}
