import { useRef, type PointerEvent, type ReactNode } from "react";

import { MessageBubble } from "~/features/messaging/components/message-bubble";
import type {
  ConversationMessage,
  MessageParticipant,
} from "~/features/messaging/model/types";
import type { PostReaction } from "~/features/posts/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";

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
}) {
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

  return (
    <article
      id={elementId}
      aria-label={`${isOwn ? "내" : (sender?.name ?? "상대방")} 메시지`}
      className={cn(
        "group/message flex items-end gap-2 rounded-2xl transition-shadow",
        isOwn ? "justify-end" : "justify-start",
        startsGroup && "mt-3",
        highlighted &&
          "ring-2 ring-primary ring-offset-4 ring-offset-background",
      )}
      onPointerDown={startReplySwipe}
      onPointerUp={finishReplySwipe}
      onPointerCancel={() => (replySwipeStart.current = null)}
    >
      {!isOwn ? (
        endsGroup ? (
          <UserAvatar
            src={sender?.avatarUrl}
            name={sender?.name}
            size="sm"
            className="mb-0.5"
          />
        ) : (
          <span className="w-6 shrink-0" aria-hidden />
        )
      ) : null}

      <div
        className={cn(
          "flex min-w-0 flex-col",
          replyTarget ? "w-[78%]" : "max-w-[78%]",
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
}

export function MessageActionRail({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex shrink-0 items-center opacity-100 transition-opacity [@media(hover:hover)]:pointer-events-none [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/message:pointer-events-auto [@media(hover:hover)]:group-focus-within/message:opacity-100 [@media(hover:hover)]:group-hover/message:pointer-events-auto [@media(hover:hover)]:group-hover/message:opacity-100">
      {children}
    </div>
  );
}
