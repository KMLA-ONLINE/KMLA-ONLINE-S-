import { ContextMenu } from "@base-ui/react/context-menu";
import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { MessageBubble } from "~/features/messaging/components/message-bubble";
import type {
  ConversationMessage,
  MessageParticipant,
} from "~/features/messaging/model/types";
import type { PostReaction } from "~/features/posts/model/types";
import { QuickReactionBar } from "~/features/posts/components/quick-reaction-bar";
import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";

export interface MessageContextAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

interface ContextMenuLayout {
  anchor: { x: number; y: number; width: number; height: number };
  translateY: number;
}

const CONTEXT_MENU_EDGE_GAP = 16;
const CONTEXT_MENU_SURFACE_GAP = 8;
const REACTION_BAR_HEIGHT = 48;
const CONTEXT_ACTION_HEIGHT = 42;

export function MessageRow({
  message,
  sender,
  isOwn,
  isGroup,
  startsGroup = true,
  endsGroup = true,
  selectedReaction,
  isPinned,
  highlighted = false,
  elementId,
  actionRail,
  showPinnedLabel = true,
  unreadParticipantCount = 0,
  showUnreadCount = true,
  showReactions = true,
  showTimestamp = true,
  replyTarget,
  replyTargetAuthor,
  onViewReply,
  onReply,
  onSelectReaction,
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
  selectedReaction?: PostReaction | null;
  isPinned: boolean;
  highlighted?: boolean;
  elementId?: string;
  actionRail?: ReactNode;
  showPinnedLabel?: boolean;
  unreadParticipantCount?: number;
  showUnreadCount?: boolean;
  showReactions?: boolean;
  showTimestamp?: boolean;
  replyTarget?: ConversationMessage;
  replyTargetAuthor?: string;
  onViewReply?: () => void;
  onReply?: () => void;
  onSelectReaction?: (reaction: PostReaction) => void;
  contextActions?: MessageContextAction[];
  contextViewportRef?: RefObject<HTMLElement | null>;
  contextPortalRef?: RefObject<HTMLElement | null>;
}) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuLayout, setContextMenuLayout] =
    useState<ContextMenuLayout | null>(null);
  const contextMenuOpenRef = useRef(false);
  const contextTouchActiveRef = useRef(false);
  const contextActionsReadyRef = useRef(false);
  const rowRef = useRef<HTMLElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const replySwipeStart = useRef<{ x: number; y: number } | null>(null);

  function startReplySwipe(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== "touch" || !onReply || message.deleted) return;
    replySwipeStart.current = { x: event.clientX, y: event.clientY };
  }

  function finishReplySwipe(event: PointerEvent<HTMLElement>) {
    const swipeStart = replySwipeStart.current;
    replySwipeStart.current = null;
    if (!swipeStart || event.pointerType !== "touch") return;

    const horizontalDistance = event.clientX - swipeStart.x;
    const verticalDistance = Math.abs(event.clientY - swipeStart.y);
    if (horizontalDistance >= 48 && horizontalDistance > verticalDistance)
      onReply?.();
  }

  function changeContextMenuOpen(open: boolean) {
    if (contextMenuOpenRef.current === open) return;
    contextMenuOpenRef.current = open;

    if (open) {
      contextActionsReadyRef.current = !contextTouchActiveRef.current;
      const row = rowRef.current;
      const bubble = bubbleRef.current;
      if (!row || !bubble) {
        contextMenuOpenRef.current = false;
        contextActionsReadyRef.current = false;
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
      const rowHalfHeight = rowRect.height / 2;
      const viewportCenter = viewportRect.top + viewportRect.height / 2;
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
        minimumCenter <= maximumCenter
          ? Math.min(Math.max(viewportCenter, minimumCenter), maximumCenter)
          : viewportCenter;
      const translateY = targetCenter - (rowRect.top + rowHalfHeight);

      setContextMenuLayout({
        anchor: {
          x: bubbleRect.left,
          y: rowRect.top + translateY,
          width: bubbleRect.width,
          height: rowRect.height,
        },
        translateY,
      });
    } else {
      contextActionsReadyRef.current = false;
    }
    setContextMenuOpen(open);
  }

  const contextMenuAnchor = contextMenuLayout
    ? {
        getBoundingClientRect: () => DOMRect.fromRect(contextMenuLayout.anchor),
      }
    : null;

  const row = (
    <article
      ref={rowRef}
      id={elementId}
      aria-label={`${isOwn ? "내" : (sender?.name ?? "상대방")} 메시지`}
      className={cn(
        "group/message flex items-end gap-2 rounded-2xl transition-[transform,box-shadow] duration-200 ease-out motion-reduce:transition-none [@media(hover:none)]:select-none",
        isOwn ? "justify-end" : "justify-start",
        startsGroup && "mt-3",
        contextMenuOpen && "relative z-50",
        highlighted &&
          "ring-2 ring-primary ring-offset-4 ring-offset-background",
      )}
      style={
        contextMenuLayout
          ? {
              transform: `translate3d(0, ${contextMenuOpen ? contextMenuLayout.translateY : 0}px, 0)`,
            }
          : undefined
      }
      onPointerDown={startReplySwipe}
      onPointerUp={finishReplySwipe}
      onPointerCancel={() => (replySwipeStart.current = null)}
      onTouchStart={() => (contextTouchActiveRef.current = true)}
      onTouchEnd={() => (contextTouchActiveRef.current = false)}
      onTouchCancel={() => (contextTouchActiveRef.current = false)}
    >
      {!isOwn ? (
        endsGroup ? (
          <UserAvatar
            src={sender?.avatarUrl}
            name={sender?.name}
            size="default"
            className="mb-0.5 size-7"
          />
        ) : (
          <span className="w-7 shrink-0" aria-hidden />
        )
      ) : null}

      <div
        className={cn(
          "flex min-w-0 flex-col",
          replyTarget ? "w-[88%] md:w-[78%]" : "max-w-[88%] md:max-w-[78%]",
          isOwn ? "items-end" : "items-start",
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
        <div
          ref={bubbleRef}
          className={cn(
            "flex min-w-0 items-center gap-1.5",
            replyTarget && "w-full",
          )}
        >
          {isOwn ? actionRail : null}
          {isOwn && showUnreadCount && unreadParticipantCount > 0 ? (
            <span
              aria-label={`${unreadParticipantCount}명 안 읽음`}
              className="mb-0.5 shrink-0 self-end text-[11px] leading-4 font-medium text-primary"
            >
              {unreadParticipantCount}
            </span>
          ) : null}
          <MessageBubble
            message={message}
            isOwn={isOwn}
            startsGroup={startsGroup}
            endsGroup={endsGroup}
            selectedReaction={selectedReaction}
            showReactions={showReactions}
            showTimestamp={showTimestamp}
            replyTarget={replyTarget}
            replyTargetAuthor={replyTargetAuthor}
            onViewReply={onViewReply}
          />
          {!isOwn ? actionRail : null}
        </div>
      </div>
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
        />
        <ContextMenu.Positioner
          anchor={contextMenuAnchor}
          positionMethod="fixed"
          side="top"
          align={isOwn ? "end" : "start"}
          sideOffset={CONTEXT_MENU_SURFACE_GAP}
          collisionPadding={16}
          className="isolate z-50 outline-none"
        >
          <ContextMenu.Popup
            data-slot="message-context-menu"
            className="relative w-max max-w-[calc(100vw-2rem)] duration-0 outline-none data-open:animate-none data-closed:animate-none"
            onTouchStartCapture={() => {
              contextActionsReadyRef.current = true;
            }}
            onKeyDownCapture={() => {
              contextActionsReadyRef.current = true;
            }}
            onClickCapture={(event) => {
              if (contextActionsReadyRef.current) return;
              event.preventDefault();
              event.stopPropagation();
            }}
            style={
              {
                "--message-context-height": `${contextMenuLayout?.anchor.height ?? 0}px`,
              } as CSSProperties
            }
          >
            {onSelectReaction ? (
              <div className="rounded-full bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
                <QuickReactionBar
                  current={selectedReaction}
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
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function MessageActionRail({ children }: { children: ReactNode }) {
  return (
    <div className="relative hidden shrink-0 items-center opacity-100 transition-opacity [@media(hover:hover)]:pointer-events-none [@media(hover:hover)]:flex [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/message:pointer-events-auto [@media(hover:hover)]:group-focus-within/message:opacity-100 [@media(hover:hover)]:group-hover/message:pointer-events-auto [@media(hover:hover)]:group-hover/message:opacity-100">
      {children}
    </div>
  );
}
