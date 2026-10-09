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
} from "~/features/posts/components/comment/comment-composer";
import { CommentThread } from "~/features/posts/components/comment/comment-thread";
import { commentDomId } from "~/features/posts/components/comment/comment-item";
import { PostActionBar } from "~/features/posts/components/post-action-bar";
import { useKeyboardViewport } from "~/features/posts/hooks/use-keyboard-viewport";
import { usePostComments } from "~/features/posts/hooks/use-post-comments";
import { AnonymousActivityRestrictionNotice } from "~/features/posts/components/anonymous-activity-restriction-notice";
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

/** 모바일은 전체화면, 데스크톱은 가운데 모달. 높이를 `90svh`로 고정해 게시물마다 크기가 출렁이지 않게 한다. */
const DETAIL_DIALOG_CLASS =
  "flex h-[90svh] flex-col gap-0 overflow-hidden bg-background p-0 ring-0 max-md:top-0 max-md:left-0 max-md:h-svh max-md:max-h-svh max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none md:max-w-2xl";

const COMMENT_SHEET_CLASS =
  "flex h-[90svh] flex-col gap-0 overflow-hidden bg-background p-0 ring-0 max-[1025px]:top-auto max-[1025px]:bottom-0 max-[1025px]:h-[98svh] max-[1025px]:max-h-[98svh] max-[1025px]:rounded-t-2xl max-[1025px]:rounded-b-none max-[1025px]:translate-y-[var(--sheet-drag-offset,0px)] max-[1025px]:data-open:zoom-in-100 max-[1025px]:data-open:slide-in-from-bottom-4 max-[1025px]:data-closed:zoom-out-100 max-[1025px]:data-closed:slide-out-to-bottom-4 max-sm:left-0 max-sm:max-w-full max-sm:translate-x-0 sm:max-[1025px]:left-1/2 sm:max-[1025px]:max-w-2xl sm:max-[1025px]:-translate-x-1/2 min-[1025px]:max-w-2xl";

const DISMISS_DRAG_DISTANCE = 96;
/** 목록에서 시작한 손짓을 당기기로 볼 최소 거리. 그 전에는 브라우저의 스크롤로 둔다. */
const PULL_START_SLOP = 6;
const TABLET_SHEET_QUERY = "(max-width: 1024px) and (hover: none)";
const TOUCH_PRIMARY_QUERY = "(hover: none) and (pointer: coarse)";

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

function subscribeToTouchPrimaryQuery(onChange: () => void) {
  const query = window.matchMedia(TOUCH_PRIMARY_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isTouchPrimaryViewport() {
  return window.matchMedia(TOUCH_PRIMARY_QUERY).matches;
}

/** 그룹·개인 게시물 상세가 공유하는 껍데기. 다른 것은 본문 영역뿐이다. */
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
  mentionGroupId,
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
  /** 본문 아래 액션 바. 댓글 수는 서버 값만 넘기면 `usePostComments`가 정본 수를 얹는다. */
  actionBar: {
    reaction: ReactionSummary;
    sharePath: string;
    shareTitle: string;
    commentCount: number;
  };
  /** 게시물 본문 영역. 종류마다 다른 유일한 부분이다. */
  children: ReactNode;
  anonymousActivityRestriction?: AnonymousActivityRestriction | null;
  /** 댓글에서 멘션할 수 있는 그룹. 개인 게시물 상세는 넘기지 않아 버튼이 없다(기능 명세 §8.14). */
  mentionGroupId?: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 스크롤 영역은 ref와 상태로 함께 잡는다. 포털이 늦게 붙어 첫 effect에는 ref가 비어 있다. */
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const attachList = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setListElement(node);
  }, []);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const thread = usePostComments(postId, comments, actionBar.commentCount);
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
  const touchPrimaryViewport = useSyncExternalStore(
    subscribeToTouchPrimaryQuery,
    isTouchPrimaryViewport,
    getServerTabletSheetViewport,
  );
  /** 바텀 시트로 그릴 것인가. 뷰포트만이 아니라 댓글만 보려는 의도(`?view=comments`)도 있어야 한다. */
  const commentSheet = commentsOnly && sheetViewport;
  const keyboardViewport = useKeyboardViewport(sheetViewport);
  const mobileDetailKeyboardOpen =
    !commentSheet && keyboardViewport.keyboardOpen;

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
  }, [
    keyboardViewport.bottomInset,
    keyboardViewport.height,
    keyboardViewport.keyboardOpen,
    replyingTo,
  ]);

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
    mentions?: Parameters<typeof thread.create>[4],
  ) => {
    const created = await thread.create(body, identity, null, image, mentions);
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
    mentions?: Parameters<typeof thread.create>[4],
  ) => {
    if (!replyingTo) return submitComment(body, image, mentions);
    const created = await thread.create(
      body,
      identity,
      replyingTo.comment_id,
      image,
      mentions,
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
   * 목록 맨 위에서 이어 아래로 당겨도 시트를 닫는다. 포인터 이벤트는 브라우저가 스크롤로 가져가 `pointercancel`로 끊기므로
   * passive 아닌 `touchmove`에서 `preventDefault`한다(`PullToRefresh`와 같다).
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
          mobileDetailKeyboardOpen &&
            "max-[1025px]:top-auto max-[1025px]:translate-y-0",
        )}
        style={
          sheetViewport
            ? ({
                // 보이는 영역의 아래에 붙인다. 화면이 끌어올려졌으면 가려진 아래쪽이 0이라
                // 레이아웃 바닥에 붙고, 그 자리가 곧 보이는 영역의 바닥이다.
                bottom: keyboardViewport.keyboardOpen
                  ? `${keyboardViewport.bottomInset}px`
                  : undefined,
                top: mobileDetailKeyboardOpen ? "auto" : undefined,
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
              commentCount={thread.commentCount}
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
              mentionGroupId={mentionGroupId}
              onReact={thread.react}
              onDelete={thread.remove}
            />
          </section>
        </div>

        {anonymousActivityRestriction ? (
          <AnonymousActivityRestrictionNotice
            restriction={anonymousActivityRestriction}
            className="border-t px-4 pt-2 text-xs text-muted-foreground"
          />
        ) : null}
        <CommentComposer
          /** 키보드가 없을 때만 홈 인디케이터 여백을 준다. iOS Safari는 키보드가 떠도 `env(safe-area-inset-bottom)`이 0이 아니라 `keyboardOpen`으로 판단한다. */
          className={cn(
            "border-t p-3",
            !keyboardViewport.keyboardOpen &&
              "pb-[calc(0.75rem+var(--app-safe-b))]",
          )}
          viewer={viewer}
          identities={identities}
          identity={identity}
          onIdentityChange={setIdentity}
          onSubmit={submit}
          mentionGroupId={mentionGroupId}
          pending={thread.pending}
          error={thread.error}
          inputRef={composerRef}
          focusOnMount={commentsOnly && !touchPrimaryViewport}
          replyTarget={replyTarget}
          onCancelReply={() => setReplyingTo(null)}
        />
      </DialogContent>
    </Dialog>
  );
}
