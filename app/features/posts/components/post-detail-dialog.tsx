import { XIcon } from "lucide-react";
import { flushSync } from "react-dom";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
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
import { useKeyboardViewport } from "~/shared/hooks/use-keyboard-viewport";
import { usePostComments } from "~/features/posts/hooks/use-post-comments";
import {
  useSheetDrag,
  useSheetViewport,
} from "~/features/posts/hooks/use-sheet-drag";
import { AnonymousActivityRestrictionNotice } from "~/features/posts/components/anonymous-activity-restriction-notice";
import type {
  PostComment,
  PostCommentPage,
  PostIdentity,
  ReactionSummary,
  AnonymousActivityRestriction,
} from "~/features/posts/model/types";
import { cn } from "~/shared/lib/utils";
import { isIOS } from "~/shared/lib/install-platform";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { PendingRegion, Skeleton } from "~/shared/ui/skeleton";

/** 모바일은 전체화면, 데스크톱은 가운데 모달. 높이를 `90svh`로 고정해 게시물마다 크기가 출렁이지 않게 한다. */
const DETAIL_DIALOG_CLASS =
  "flex h-[90svh] flex-col gap-0 overflow-hidden bg-background p-0 ring-0 max-md:top-0 max-md:left-0 max-md:h-svh max-md:max-h-svh max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none md:max-w-2xl";

const COMMENT_SHEET_CLASS =
  "flex h-[90svh] flex-col gap-0 overflow-hidden bg-background p-0 ring-0 min-[1025px]:max-w-2xl";

const TOUCH_PRIMARY_QUERY = "(hover: none) and (pointer: coarse)";

function subscribeToTouchPrimaryQuery(onChange: () => void) {
  const query = window.matchMedia(TOUCH_PRIMARY_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isTouchPrimaryViewport() {
  return window.matchMedia(TOUCH_PRIMARY_QUERY).matches;
}

// 플랫폼은 페이지가 열린 동안 바뀌지 않는다. 서버에서는 기본 화면으로 렌더한다.
function subscribeToPlatform() {
  return () => undefined;
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
  /** null이면 댓글을 불러오는 중이다. 본문은 그대로 그리고 댓글 자리만 스켈레톤으로 둔다. */
  comments: PostCommentPage | null;
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
  const restoreComposerFocus = useRef<(() => void) | null>(null);
  useEffect(() => () => restoreComposerFocus.current?.(), []);
  const thread = usePostComments(postId, comments, actionBar.commentCount);
  const [identity, setIdentity] = useState<PostIdentity>(identities[0]);
  const [replyingTo, setReplyingTo] = useState<PostComment | null>(null);
  const [searchParams] = useSearchParams();
  const commentsOnly = searchParams.get("view") === "comments";
  const sheetViewport = useSheetViewport();
  const touchPrimaryViewport = useSyncExternalStore(
    subscribeToTouchPrimaryQuery,
    isTouchPrimaryViewport,
    () => false,
  );
  /** 바텀 시트로 그릴 것인가. 뷰포트만이 아니라 댓글만 보려는 의도(`?view=comments`)도 있어야 한다. */
  const commentSheet = commentsOnly && sheetViewport;
  const { handleProps, sheetClassName, sheetStyle } = useSheetDrag({
    enabled: commentSheet,
    scrollElement: listElement,
    onDismiss: onClose,
  });
  const ios = useSyncExternalStore(subscribeToPlatform, isIOS, () => false);
  const keyboardViewport = useKeyboardViewport(ios && sheetViewport, ios);
  const mobileDetailKeyboardOpen =
    !commentSheet && keyboardViewport.keyboardOpen;

  useEffect(() => {
    if (!replyingTo || !listElement) return;
    let frame = 0;
    const revealTarget = () => {
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
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(revealTarget);
    };
    // Android는 브라우저가 목록을 줄인다. 화면 위치 보정과 별개로 목록 안의 답글 대상만 드러낸다.
    const observer = new ResizeObserver(schedule);
    observer.observe(listElement);
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [
    listElement,
    keyboardViewport.offsetTop,
    keyboardViewport.height,
    keyboardViewport.keyboardOpen,
    replyingTo,
  ]);

  // 본문 영역이 액션 바에서 부르는 핸들러다. JSX 안에서 즉석 클로저로 만들면 render 중에
  // ref를 읽는 것으로 잡힌다.
  const prepareComposerFocus = useCallback(() => {
    const element = composerRef.current;
    if (
      !element ||
      !ios ||
      !sheetViewport ||
      window.visualViewport?.scale !== 1 ||
      restoreComposerFocus.current
    )
      return;

    // iOS는 preventScroll을 줘도 키보드 resize 전에 입력창으로 화면을 밀 수 있다.
    // 한 프레임만 투명하게 해 그 이동을 막는다. 직접 탭한 경우에도 focus capture에서
    // 실행해 제목으로 연 상세와 댓글 시트가 같은 처리를 거친다.
    const opacity = element.style.opacity;
    element.style.opacity = "0";
    const restore = () => {
      element.style.opacity = opacity;
      restoreComposerFocus.current = null;
    };
    const frame = requestAnimationFrame(restore);
    restoreComposerFocus.current = () => {
      cancelAnimationFrame(frame);
      restore();
    };
  }, [ios, sheetViewport]);

  const focusComposer = useCallback(() => {
    const element = composerRef.current;
    if (!element || document.activeElement === element) return;
    if (ios && sheetViewport && window.visualViewport?.scale === 1) {
      prepareComposerFocus();
      element.focus({ preventScroll: true });
    } else {
      // Android·데스크톱·확대 상태에서는 브라우저의 기본 포커스 이동을 유지한다.
      element.focus();
    }
  }, [ios, sheetViewport, prepareComposerFocus]);

  const startReply = (comment: PostComment) => {
    if (ios) {
      // iOS에서만 대상 줄을 먼저 반영하고 같은 탭 이벤트 안에서 키보드를 연다.
      flushSync(() => setReplyingTo(comment));
      focusComposer();
    } else {
      setReplyingTo(comment);
      requestAnimationFrame(focusComposer);
    }
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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        onFocusCapture={(event) => {
          if (event.target.isSameNode(composerRef.current))
            prepareComposerFocus();
        }}
        className={cn(
          commentSheet
            ? cn(COMMENT_SHEET_CLASS, sheetClassName)
            : DETAIL_DIALOG_CLASS,
          mobileDetailKeyboardOpen &&
            "max-[1025px]:top-auto max-[1025px]:translate-y-0",
        )}
        style={
          sheetViewport
            ? {
                // iOS만 visual viewport를 보정한다. Android는 브라우저의 content resize를 쓴다.
                top: keyboardViewport.keyboardOpen
                  ? `${keyboardViewport.offsetTop}px`
                  : undefined,
                bottom: keyboardViewport.keyboardOpen ? "auto" : undefined,
                height: keyboardViewport.keyboardOpen
                  ? `${keyboardViewport.height}px`
                  : undefined,
                maxHeight:
                  keyboardViewport.height === null
                    ? undefined
                    : `${keyboardViewport.height}px`,
                ...sheetStyle,
              }
            : undefined
        }
      >
        <div
          className={cn(
            "shrink-0",
            commentSheet &&
              "max-[1025px]:cursor-grab max-[1025px]:touch-none max-[1025px]:active:cursor-grabbing",
          )}
          {...handleProps}
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
            // overscroll-y-contain: 맨 위에서 더 당길 때 브라우저의 고무줄과 새로고침
            // 제스처가 손짓을 가져가지 않도록 이 영역에 가둔다.
            commentSheet && "overscroll-x-desktop-auto overscroll-y-contain",
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
            {thread.initialLoading ? (
              <CommentThreadSkeleton />
            ) : (
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
            )}
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
          // 첫 페이지가 오기 전에 쓴 댓글은 그 페이지가 도착하며 지워진다.
          pending={thread.pending || thread.initialLoading}
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

function CommentThreadSkeleton() {
  return (
    <PendingRegion label="댓글을" className="space-y-4">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex gap-2">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </PendingRegion>
  );
}
