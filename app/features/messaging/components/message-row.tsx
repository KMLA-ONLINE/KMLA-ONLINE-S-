import { ContextMenu } from "@base-ui/react/context-menu";
import { ReplyIcon } from "lucide-react";
import { Link } from "react-router";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";

import { MessageBubble } from "~/features/messaging/components/message-bubble";
import { formatMessageTime } from "~/features/messaging/model/message-time";
import type {
  ConversationMessage,
  MessageParticipant,
  MessageReplyPreview,
} from "~/features/messaging/model/types";
import type { PostReaction } from "~/features/posts/model/types";
import { QuickReactionBar } from "~/features/posts/components/reaction/quick-reaction-bar";
import { ReactionEmoji } from "~/features/posts/components/reaction/reaction-emoji";
import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/shared/ui/tooltip";

export interface MessageContextAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

interface ContextMenuLayout {
  anchor: { x: number; y: number; width: number; height: number };
  translateY: number;
  constrainedToViewport: boolean;
  flowHeight: number;
}

const CONTEXT_MENU_EDGE_GAP = 16;
const CONTEXT_MENU_SURFACE_GAP = 8;
const REACTION_BAR_HEIGHT = 48;
const CONTEXT_ACTION_HEIGHT = 42;
const INLINE_TIMESTAMP_HEIGHT = 15;
const CONTEXT_MENU_MOVE_DURATION = 200;
/** 이보다 오래 누르면 탭이 아니라 길게 누르기다. 길게 누르기는 메뉴를 연다. */
const TAP_MAX_DURATION_MS = 400;
/** 두 번째 탭이 이 안에 오면 더블탭이다. 반응을 남길 수 있는 메시지는 한 번 탭(시각)을 이만큼 미룬다. */
const DOUBLE_TAP_WINDOW_MS = 280;
/** 손가락이 이만큼 움직이면 가로 스와이프인지 세로 스크롤인지 정한다. 길게 누르기 취소(10px)보다 작다. */
const GESTURE_SLOP = 8;
/** 답장 스와이프가 답장을 시작하는 거리. 넘으면 답장 아이콘이 강조된다. */
const REPLY_SWIPE_THRESHOLD = 60;
/** 기준을 넘은 뒤로는 손가락 이동의 일부만 따라가 이 거리에서 멈춘다. */
const REPLY_SWIPE_MAX = 84;
const REPLY_SWIPE_OVERSHOOT_RATIO = 0.3;
/** 스와이프로 밀리는 부분. 끄는 동안은 손가락을 바로 따르고, 손을 떼면 transition으로 제자리에 돌아온다. */
const REPLY_SWIPE_SHIFT =
  "translate-x-(--reply-swipe-x) transition-transform duration-200 ease-out group-data-swiping/message:transition-none motion-reduce:transition-none";

export function MessageRow({
  message,
  sender,
  isOwn,
  isGroup,
  startsGroup = true,
  endsGroup = true,
  isPinned,
  highlighted = false,
  elementId,
  actionRail,
  showPinnedLabel = true,
  unreadParticipantCount = 0,
  showUnreadCount = true,
  showReactions = true,
  showTimestamp = false,
  replyTarget,
  replyTargetAuthor,
  onViewReply,
  onReply,
  onSelectReaction,
  onShowReactions,
  contextActions,
  contextViewportRef,
  contextPortalRef,
}: {
  message: ConversationMessage;
  sender?: MessageParticipant;
  isOwn: boolean;
  isGroup: boolean;
  startsGroup?: boolean;
  endsGroup?: boolean;
  isPinned: boolean;
  highlighted?: boolean;
  elementId?: string;
  actionRail?: ReactNode;
  showPinnedLabel?: boolean;
  unreadParticipantCount?: number;
  showUnreadCount?: boolean;
  showReactions?: boolean;
  showTimestamp?: boolean;
  replyTarget?: MessageReplyPreview;
  replyTargetAuthor?: string;
  onViewReply?: () => void;
  onReply?: () => void;
  onSelectReaction?: (reaction: PostReaction) => void;
  /** 반응 표시를 누르면 반응한 사람을 보여 준다. */
  onShowReactions?: () => void;
  contextActions?: MessageContextAction[];
  contextViewportRef?: RefObject<HTMLElement | null>;
  contextPortalRef?: RefObject<HTMLElement | null>;
}) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextOpenedByTouch, setContextOpenedByTouch] = useState(false);
  const [contextMenuReady, setContextMenuReady] = useState(false);
  const [contextMenuLayout, setContextMenuLayout] =
    useState<ContextMenuLayout | null>(null);
  const contextMenuOpenRef = useRef(false);
  const contextTouchActiveRef = useRef(false);
  const contextInteractionReadyRef = useRef(false);
  const rowRef = useRef<HTMLElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const replySwipe = useRef<{
    pointerId: number;
    x: number;
    y: number;
    swiping: boolean;
    armed: boolean;
  } | null>(null);
  // 스와이프를 끝낸 손가락을 뗄 때 오는 click은 탭이 아니다.
  const swallowClick = useRef(false);
  // 손가락으로 버블을 탭하면 버블 안쪽 하단의 시각을 켜고 끈다. 마우스는 시간 카드가 맡는다.
  const [timeShownByTap, setTimeShownByTap] = useState(false);
  const tapStart = useRef<{ pointerType: string; at: number } | null>(null);
  const singleTapTimer = useRef(0);
  // 더블탭으로 ❤️를 남길 때마다 하나씩 올려 하트 애니메이션을 새로 띄운다.
  const [heartBurst, setHeartBurst] = useState(0);
  // 상대 메시지는 오른쪽, 내 메시지는 왼쪽(대화 가운데 쪽)으로 민다.
  const replySwipeDirection = isOwn ? -1 : 1;
  const timeVisible = showTimestamp || timeShownByTap;
  const hasVisibleReactions =
    showReactions && (message.reactions?.length ?? 0) > 0;

  useEffect(() => () => window.clearTimeout(singleTapTimer.current), []);

  function startReplySwipe(event: PointerEvent<HTMLElement>) {
    swallowClick.current = false;
    if (
      event.pointerType !== "touch" ||
      !onReply ||
      message.deleted ||
      contextMenuOpenRef.current
    ) {
      return;
    }
    replySwipe.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      swiping: false,
      armed: false,
    };
  }

  function moveReplySwipe(event: PointerEvent<HTMLElement>) {
    const swipe = replySwipe.current;
    if (swipe?.pointerId !== event.pointerId) return;
    const horizontal = event.clientX - swipe.x;
    const vertical = event.clientY - swipe.y;
    const row = event.currentTarget;

    if (!swipe.swiping) {
      if (
        Math.abs(horizontal) < GESTURE_SLOP &&
        Math.abs(vertical) < GESTURE_SLOP
      ) {
        return;
      }
      // 세로로 먼저 움직였거나 반대쪽으로 민 것은 스크롤에 넘긴다.
      if (
        Math.abs(horizontal) <= Math.abs(vertical) ||
        horizontal * replySwipeDirection <= 0
      ) {
        replySwipe.current = null;
        return;
      }
      swipe.swiping = true;
      swallowClick.current = true;
      row.setPointerCapture(event.pointerId);
      row.dataset.swiping = "";
    }

    const distance = Math.max(0, horizontal * replySwipeDirection);
    const offset =
      distance <= REPLY_SWIPE_THRESHOLD
        ? distance
        : Math.min(
            REPLY_SWIPE_MAX,
            REPLY_SWIPE_THRESHOLD +
              (distance - REPLY_SWIPE_THRESHOLD) * REPLY_SWIPE_OVERSHOOT_RATIO,
          );
    const armed = distance >= REPLY_SWIPE_THRESHOLD;
    if (armed && !swipe.armed && "vibrate" in navigator) navigator.vibrate(10);
    swipe.armed = armed;
    row.style.setProperty(
      "--reply-swipe-x",
      `${offset * replySwipeDirection}px`,
    );
    row.style.setProperty(
      "--reply-swipe-progress",
      String(Math.min(distance / REPLY_SWIPE_THRESHOLD, 1)),
    );
    if (armed) row.dataset.replyArmed = "";
    else delete row.dataset.replyArmed;
  }

  function finishReplySwipe(event: PointerEvent<HTMLElement>) {
    const swipe = replySwipe.current;
    if (swipe?.pointerId !== event.pointerId) return;
    replySwipe.current = null;
    const row = event.currentTarget;
    delete row.dataset.swiping;
    delete row.dataset.replyArmed;
    row.style.removeProperty("--reply-swipe-x");
    row.style.removeProperty("--reply-swipe-progress");
    if (swipe.armed && event.type === "pointerup") onReply?.();
  }

  function swallowSwipeClick(event: MouseEvent<HTMLElement>) {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function startTap(event: PointerEvent<HTMLElement>) {
    tapStart.current = { pointerType: event.pointerType, at: event.timeStamp };
  }

  function handleTap(event: MouseEvent<HTMLElement>) {
    const start = tapStart.current;
    tapStart.current = null;
    if (start?.pointerType !== "touch" || contextMenuOpenRef.current) return;
    if (event.timeStamp - start.at > TAP_MAX_DURATION_MS) return;
    // 사진, 링크, 답장 인용, 반응 표시처럼 자기 일이 있는 곳을 누른 것은 시각을 켜지 않는다.
    if (
      event.target instanceof Element &&
      event.target.closest("a, button, input, audio")
    ) {
      return;
    }
    if (!onSelectReaction) {
      setTimeShownByTap((shown) => !shown);
      return;
    }
    // 두 번째 탭이 오면 ❤️를 남기거나(다른 반응이면 바꾸고) 이미 ❤️면 지운다. 같은 반응을 다시 고르면
    // 지우는 것은 반응 선택이 맡는다. 첫 탭의 시각 켜기는 더블탭이 아닐 때만 뒤늦게 처리한다.
    if (singleTapTimer.current) {
      window.clearTimeout(singleTapTimer.current);
      singleTapTimer.current = 0;
      if (message.myReaction !== "love") setHeartBurst((count) => count + 1);
      onSelectReaction("love");
      return;
    }
    singleTapTimer.current = window.setTimeout(() => {
      singleTapTimer.current = 0;
      setTimeShownByTap((shown) => !shown);
    }, DOUBLE_TAP_WINDOW_MS);
  }

  // 부모가 렌더마다 새 콜백을 넘기므로 effect는 함수 대신 반응 막대 유무에만 의존한다.
  const hasReactionBar = Boolean(onSelectReaction);

  function changeContextMenuOpen(open: boolean) {
    if (contextMenuOpenRef.current === open) return;
    contextMenuOpenRef.current = open;

    if (open) {
      // The modal menu hides its background from assistive technology, so a
      // focused composer must leave that background before it opens.
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      contextInteractionReadyRef.current = !contextTouchActiveRef.current;
      setContextOpenedByTouch(contextTouchActiveRef.current);
      setContextMenuReady(false);
      const row = rowRef.current;
      const bubble = bubbleRef.current;
      if (!row || !bubble) {
        contextMenuOpenRef.current = false;
        contextInteractionReadyRef.current = false;
        return;
      }

      const rowRect = row.getBoundingClientRect();
      const bubbleRect = bubble.getBoundingClientRect();
      const viewportRect =
        contextViewportRef?.current?.getBoundingClientRect() ??
        DOMRect.fromRect({
          width: window.innerWidth,
          height: window.innerHeight,
        });
      const reactionSpace = onSelectReaction
        ? REACTION_BAR_HEIGHT + CONTEXT_MENU_SURFACE_GAP
        : 0;
      const actionSpace = contextActions?.length
        ? contextActions.length * CONTEXT_ACTION_HEIGHT +
          CONTEXT_MENU_SURFACE_GAP
        : 0;
      const messageHeight =
        rowRect.height +
        (contextTouchActiveRef.current && !timeVisible
          ? INLINE_TIMESTAMP_HEIGHT
          : 0);
      const rowHalfHeight = messageHeight / 2;
      const viewportCenter = viewportRect.top + viewportRect.height / 2;
      const availableMessageHeight = Math.max(
        0,
        viewportRect.height -
          CONTEXT_MENU_EDGE_GAP * 2 -
          reactionSpace -
          actionSpace,
      );
      const constrainedToViewport = messageHeight > availableMessageHeight;
      const minimumCenter =
        viewportRect.top +
        CONTEXT_MENU_EDGE_GAP +
        reactionSpace +
        rowHalfHeight;
      const maximumCenter =
        viewportRect.bottom -
        CONTEXT_MENU_EDGE_GAP -
        actionSpace -
        rowHalfHeight;
      const targetCenter =
        !constrainedToViewport && minimumCenter <= maximumCenter
          ? Math.min(Math.max(viewportCenter, minimumCenter), maximumCenter)
          : viewportCenter;
      const translateY = targetCenter - (rowRect.top + rowHalfHeight);

      setContextMenuLayout({
        anchor: {
          x: bubbleRect.left,
          y: constrainedToViewport
            ? viewportRect.top + CONTEXT_MENU_EDGE_GAP + reactionSpace
            : rowRect.top + translateY,
          width: bubbleRect.width,
          height: constrainedToViewport
            ? availableMessageHeight
            : messageHeight,
        },
        translateY,
        constrainedToViewport,
        flowHeight: rowRect.height,
      });
    } else {
      contextInteractionReadyRef.current = false;
      setContextOpenedByTouch(false);
      setContextMenuReady(false);
    }
    setContextMenuOpen(open);
  }

  function armContextInteraction() {
    contextInteractionReadyRef.current = true;
  }

  function blockOpeningTouchClick(event: MouseEvent<HTMLElement>) {
    if (contextInteractionReadyRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }

  useEffect(() => {
    if (!contextMenuOpen) return;

    const row = rowRef.current;
    const visualViewport = window.visualViewport;
    let animationFrame = 0;
    let revealAnimationFrame = 0;
    let revealTimeout = 0;

    function updateAnchor() {
      const currentRow = rowRef.current;
      const bubble = bubbleRef.current;
      if (!currentRow || !bubble) return;

      const rowRect = currentRow.getBoundingClientRect();
      const bubbleRect = bubble.getBoundingClientRect();
      const viewportRect =
        contextViewportRef?.current?.getBoundingClientRect() ??
        DOMRect.fromRect({
          width: window.innerWidth,
          height: window.innerHeight,
        });
      const reactionSpace = hasReactionBar
        ? REACTION_BAR_HEIGHT + CONTEXT_MENU_SURFACE_GAP
        : 0;
      const actionSpace = contextActions?.length
        ? contextActions.length * CONTEXT_ACTION_HEIGHT +
          CONTEXT_MENU_SURFACE_GAP
        : 0;
      const availableMessageHeight = Math.max(
        0,
        viewportRect.height -
          CONTEXT_MENU_EDGE_GAP * 2 -
          reactionSpace -
          actionSpace,
      );
      const messageHeight =
        rowRect.height +
        (contextOpenedByTouch && !timeVisible ? INLINE_TIMESTAMP_HEIGHT : 0);
      const constrainedToViewport = messageHeight > availableMessageHeight;
      const nextAnchor = {
        x: bubbleRect.left,
        y: constrainedToViewport
          ? viewportRect.top + CONTEXT_MENU_EDGE_GAP + reactionSpace
          : rowRect.top,
        width: bubbleRect.width,
        height: constrainedToViewport ? availableMessageHeight : messageHeight,
      };

      setContextMenuLayout((current) => {
        if (!current) return current;
        const anchor = current.anchor;
        if (
          anchor.x === nextAnchor.x &&
          anchor.y === nextAnchor.y &&
          anchor.width === nextAnchor.width &&
          anchor.height === nextAnchor.height &&
          current.constrainedToViewport === constrainedToViewport
        ) {
          return current;
        }
        return {
          ...current,
          anchor: nextAnchor,
          constrainedToViewport,
        };
      });
    }

    function scheduleAnchorUpdate() {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(updateAnchor);
    }

    function handleTransitionEnd(event: TransitionEvent) {
      if (event.target === row && event.propertyName === "transform") {
        scheduleAnchorUpdate();
        if (contextOpenedByTouch) setContextMenuReady(true);
      }
    }

    function revealContextMenu() {
      scheduleAnchorUpdate();
      setContextMenuReady(true);
    }

    function handleTransitionCancel(event: TransitionEvent) {
      if (event.target === row && event.propertyName === "transform") {
        revealContextMenu();
      }
    }

    visualViewport?.addEventListener("resize", scheduleAnchorUpdate);
    visualViewport?.addEventListener("scroll", scheduleAnchorUpdate);
    window.addEventListener("resize", scheduleAnchorUpdate);
    row?.addEventListener("transitionend", handleTransitionEnd);
    row?.addEventListener("transitioncancel", handleTransitionCancel);
    if (!contextOpenedByTouch) {
      scheduleAnchorUpdate();
    } else if (
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      scheduleAnchorUpdate();
      revealAnimationFrame = requestAnimationFrame(() =>
        setContextMenuReady(true),
      );
    } else {
      revealTimeout = window.setTimeout(
        revealContextMenu,
        CONTEXT_MENU_MOVE_DURATION + 50,
      );
    }

    return () => {
      cancelAnimationFrame(animationFrame);
      cancelAnimationFrame(revealAnimationFrame);
      window.clearTimeout(revealTimeout);
      visualViewport?.removeEventListener("resize", scheduleAnchorUpdate);
      visualViewport?.removeEventListener("scroll", scheduleAnchorUpdate);
      window.removeEventListener("resize", scheduleAnchorUpdate);
      row?.removeEventListener("transitionend", handleTransitionEnd);
      row?.removeEventListener("transitioncancel", handleTransitionCancel);
    };
  }, [
    contextActions?.length,
    contextMenuOpen,
    contextOpenedByTouch,
    contextViewportRef,
    hasReactionBar,
    timeVisible,
  ]);

  const contextMenuAnchor = contextMenuLayout
    ? {
        getBoundingClientRect: () => DOMRect.fromRect(contextMenuLayout.anchor),
      }
    : null;

  // 읽지 않은 멤버 수는 버블 바깥쪽 아래에 둔다. 내 메시지는 왼쪽, 상대 메시지는 오른쪽이다.
  // 숫자가 0이 되어도 자리는 남긴다. 자리가 사라지면 버블이 쓸 수 있는 폭이 넓어져 긴 메시지의 줄바꿈과
  // 버블 크기가 읽힐 때 바뀐다. 1:1 대화의 상대 메시지는 숫자가 생길 일이 없어 자리를 두지 않는다.
  const hasUnreadCount = unreadParticipantCount > 0;
  const unreadCount =
    showUnreadCount && (isOwn || isGroup) ? (
      <span
        aria-label={
          hasUnreadCount ? `${unreadParticipantCount}명 안 읽음` : undefined
        }
        aria-hidden={hasUnreadCount ? undefined : true}
        className={cn(
          "min-w-[1ch] shrink-0 self-end text-[11px] leading-4 font-medium text-primary tabular-nums",
          hasVisibleReactions ? "mb-[1.125rem]" : "mb-0.5",
          !hasUnreadCount && "invisible",
        )}
      >
        {hasUnreadCount ? unreadParticipantCount : null}
      </span>
    ) : null;

  const row = (
    <article
      ref={rowRef}
      id={elementId}
      aria-label={`${isOwn ? "내" : (sender?.name ?? "상대방")} 메시지`}
      className={cn(
        "group/message relative flex w-full items-end gap-2 rounded-2xl transition-[transform,box-shadow] duration-200 ease-out motion-reduce:transition-none [@media(hover:none)]:select-none",
        // 가로 이동은 답장 스와이프가 받는다. 두 번 탭해 확대하는 것도 막아 더블탭 반응과 겹치지 않는다.
        (onReply ?? onSelectReaction) && "touch-pan-y",
        isOwn ? "justify-end" : "justify-start",
        startsGroup && "mt-3",
        contextMenuOpen && "z-50",
      )}
      style={
        contextMenuLayout
          ? {
              transform: `translate3d(0, ${contextMenuOpen ? contextMenuLayout.translateY : 0}px, 0)`,
              ...(contextOpenedByTouch
                ? { height: contextMenuLayout.flowHeight, overflow: "visible" }
                : {}),
            }
          : undefined
      }
      onPointerDown={startReplySwipe}
      onPointerMove={moveReplySwipe}
      onPointerUp={finishReplySwipe}
      onPointerCancel={finishReplySwipe}
      onClickCapture={swallowSwipeClick}
      onTouchStart={() => (contextTouchActiveRef.current = true)}
      onTouchEnd={() => (contextTouchActiveRef.current = false)}
      onTouchCancel={() => (contextTouchActiveRef.current = false)}
    >
      {!isOwn ? (
        endsGroup ? (
          <SenderAvatar
            sender={sender}
            className={cn(
              hasVisibleReactions ? "mb-[1.125rem]" : "mb-0.5",
              "size-7",
              REPLY_SWIPE_SHIFT,
              contextOpenedByTouch && !timeVisible && "translate-y-[15px]",
            )}
          />
        ) : (
          <span className="w-7 shrink-0" aria-hidden />
        )
      ) : null}

      <div
        className={cn(
          "flex min-w-0 flex-col",
          "max-w-[78%]",
          REPLY_SWIPE_SHIFT,
          isOwn ? "items-end" : "items-start",
          contextOpenedByTouch && "self-start",
        )}
      >
        {!isOwn && ((isGroup && startsGroup) || isPinned) ? (
          <span className="mb-1 ml-2 flex items-center gap-1 text-xs text-muted-foreground">
            <span>{sender?.name ?? "알 수 없는 사용자"}</span>
            {isPinned && showPinnedLabel ? (
              <>
                <span aria-hidden>·</span>
                <span>고정됨</span>
              </>
            ) : null}
          </span>
        ) : null}
        {isOwn && isPinned && showPinnedLabel ? (
          <span className="mr-2 mb-1 text-xs text-muted-foreground">
            고정됨
          </span>
        ) : null}
        {/* 탭으로 시각을 보는 것은 손가락 전용 지름길이다. 마우스는 시간 카드로 본다. */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div
          className={cn("flex w-full min-w-0 items-center gap-1.5")}
          onPointerDown={startTap}
          onClick={handleTap}
        >
          {isOwn ? actionRail : null}
          {isOwn ? unreadCount : null}
          <MessageTimeCard
            message={message}
            showTimeCard={!timeVisible}
            overlay={
              heartBurst ? (
                <HeartBurst key={heartBurst} onDone={() => setHeartBurst(0)} />
              ) : null
            }
          >
            <MessageBubble
              anchorRef={bubbleRef}
              message={message}
              isOwn={isOwn}
              highlighted={highlighted}
              startsGroup={startsGroup}
              endsGroup={endsGroup}
              showReactions={showReactions}
              showTimestamp={timeVisible || contextOpenedByTouch}
              replyTarget={replyTarget}
              replyTargetAuthor={replyTargetAuthor}
              onViewReply={onViewReply}
              onShowReactions={onShowReactions}
            />
          </MessageTimeCard>
          {!isOwn ? unreadCount : null}
          {!isOwn ? actionRail : null}
        </div>
      </div>
      {onReply && !message.deleted ? (
        // 밀어서 드러난 자리에 답장 아이콘이 점점 커지며 나타나고, 답장할 거리를 넘으면 강조된다.
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-1/2 flex size-8 -translate-y-1/2 scale-[calc(0.5+var(--reply-swipe-progress,0)*0.5)] items-center justify-center rounded-full bg-muted text-muted-foreground opacity-[var(--reply-swipe-progress,0)] transition-[opacity,scale] duration-200 group-data-reply-armed/message:bg-primary group-data-reply-armed/message:text-primary-foreground group-data-swiping/message:transition-none motion-reduce:transition-none",
            isOwn ? "right-1" : "left-1",
          )}
        >
          <ReplyIcon className="size-4" />
        </span>
      ) : null}
    </article>
  );

  if (!onSelectReaction && !contextActions?.length) return row;

  return (
    <ContextMenu.Root
      open={contextMenuOpen}
      onOpenChange={changeContextMenuOpen}
    >
      <ContextMenu.Trigger render={row} />
      <ContextMenu.Portal container={contextPortalRef}>
        <ContextMenu.Backdrop
          data-slot="message-context-backdrop"
          className="fixed inset-0 z-40 bg-background/90 duration-0 data-open:animate-none data-closed:animate-none"
          onTouchStartCapture={armContextInteraction}
          onClickCapture={blockOpeningTouchClick}
          onClick={() => changeContextMenuOpen(false)}
        />
        {!contextOpenedByTouch || contextMenuReady ? (
          <ContextMenu.Positioner
            anchor={contextMenuAnchor}
            positionMethod="fixed"
            side="top"
            align={isOwn ? "end" : "start"}
            sideOffset={CONTEXT_MENU_SURFACE_GAP}
            collisionAvoidance={{ align: "shift" }}
            collisionPadding={16}
            className="isolate z-50 outline-none"
          >
            <ContextMenu.Popup
              data-slot="message-context-menu"
              className={cn(
                "relative w-max max-w-[calc(100vw-2rem)] duration-0 outline-none data-open:animate-none data-closed:animate-none",
                !onSelectReaction && contextActions?.length && "min-w-56",
              )}
              onTouchStartCapture={armContextInteraction}
              onKeyDownCapture={armContextInteraction}
              onClickCapture={blockOpeningTouchClick}
              style={
                {
                  "--message-context-height": `${contextMenuLayout?.anchor.height ?? 0}px`,
                } as CSSProperties
              }
            >
              {onSelectReaction ? (
                <div className="rounded-full bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
                  <QuickReactionBar
                    current={message.myReaction}
                    onSelect={(reaction) => {
                      onSelectReaction(reaction);
                      changeContextMenuOpen(false);
                    }}
                  />
                </div>
              ) : null}
              {contextActions?.length ? (
                <ContextMenu.Group
                  className={cn(
                    "absolute top-[calc(100%+var(--message-context-height)+1rem)] min-w-56 rounded-xl bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10",
                    isOwn ? "right-0" : "left-0",
                  )}
                >
                  {contextActions.map((action) => (
                    <ContextMenu.Item
                      key={action.label}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground [&_svg]:size-5 [&_svg]:shrink-0"
                      onClick={action.onSelect}
                    >
                      {action.icon}
                      {action.label}
                    </ContextMenu.Item>
                  ))}
                </ContextMenu.Group>
              ) : null}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        ) : null}
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** 상대 메시지 옆 프로필 사진. 프로필 주소를 알면 누를 때 그 사람의 프로필로 간다. */
function SenderAvatar({
  sender,
  className,
}: {
  sender?: MessageParticipant;
  className: string;
}) {
  const avatar = (
    <UserAvatar
      src={sender?.avatarUrl}
      name={sender?.name}
      size="default"
      className={sender?.pubId ? "size-7" : className}
    />
  );
  if (!sender?.pubId) return avatar;
  return (
    <Link
      to={`/profile/${sender.pubId}`}
      aria-label={`${sender.name} 프로필`}
      className={cn(
        "shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
    >
      {avatar}
    </Link>
  );
}

/** 더블탭으로 ❤️를 남길 때 버블 위로 톡 튀었다 사라지는 하트. 움직임 줄이기 설정에서는 띄우지 않는다. */
function HeartBurst({ onDone }: { onDone: () => void }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center motion-reduce:hidden"
    >
      <span
        className="animate-message-heart drop-shadow-md"
        onAnimationEnd={onDone}
      >
        <ReactionEmoji reaction="love" className="size-12" />
      </span>
    </span>
  );
}

function MessageTimeCard({
  message,
  showTimeCard,
  overlay,
  children,
}: {
  message: ConversationMessage;
  showTimeCard: boolean;
  /** 버블 위에 겹쳐 그릴 것. 버블 뒤에 두어 버블이 다시 마운트되지 않게 한다. */
  overlay?: ReactNode;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  // 손가락으로 누를 때는 길게 누르기가 버블 안에 시각을 보이므로 카드를 띄우지 않는다. `hover: none`
  // 미디어 쿼리로 가리면 터치스크린이 달린 노트북에서 터치패드로 눌러도 카드가 숨으므로, 기기가 아니라
  // 이번에 누른 포인터의 종류로 가른다.
  const pointerType = useRef("");

  // 툴팁은 기본으로 누르면 닫힌다. 터치패드로 탭해 시각을 보려는 사람에게는 반대가 되므로, 눌러도
  // 닫지 않고 닫혀 있었으면 연다. 포인터가 떠나면 평소처럼 닫힌다. 시각이 버블 안에 보일 때는 끄기만
  // 하고 감싼 구조는 그대로 둔다. 구조가 바뀌면 버블이 다시 마운트되어 사진을 다시 그리고 재생 중인
  // 오디오가 멈춘다.
  return (
    <Tooltip
      disabled={!showTimeCard}
      open={showTimeCard && open}
      onOpenChange={(next) => {
        if (next && pointerType.current === "touch") return;
        setOpen(next);
      }}
    >
      <TooltipTrigger
        closeOnClick={false}
        render={<span className="relative block w-fit max-w-full min-w-0" />}
        onPointerEnter={(event) => (pointerType.current = event.pointerType)}
        onPointerDown={(event) => (pointerType.current = event.pointerType)}
        onClick={() => {
          if (pointerType.current !== "touch") setOpen(true);
        }}
      >
        {children}
        {overlay}
      </TooltipTrigger>
      <TooltipContent>{formatMessageTime(message.sentAt)}</TooltipContent>
    </Tooltip>
  );
}

export function MessageActionRail({ children }: { children: ReactNode }) {
  return (
    <div className="relative hidden shrink-0 items-center opacity-100 transition-opacity [@media(hover:hover)]:pointer-events-none [@media(hover:hover)]:flex [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/message:pointer-events-auto [@media(hover:hover)]:group-focus-within/message:opacity-100 [@media(hover:hover)]:group-hover/message:pointer-events-auto [@media(hover:hover)]:group-hover/message:opacity-100">
      {children}
    </div>
  );
}
