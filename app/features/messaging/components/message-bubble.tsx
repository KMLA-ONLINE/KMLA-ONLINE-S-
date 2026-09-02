import { ThumbsUpIcon } from "lucide-react";
import type { Ref } from "react";

import {
  getEmojiOnlyMessageGraphemes,
  parseMessageText,
} from "~/features/messaging/model/message-text";
import type { ConversationMessage } from "~/features/messaging/model/types";
import { ReactionEmoji } from "~/features/posts/components/reaction-emoji";
import type { PostReaction } from "~/features/posts/model/types";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";

export function MessageBubble({
  message,
  isOwn,
  startsGroup = true,
  endsGroup = true,
  selectedReaction,
  showReactions = true,
  showTimestamp = true,
  replyTarget,
  replyTargetAuthor,
  onViewReply,
  anchorRef,
}: {
  message: ConversationMessage;
  isOwn: boolean;
  startsGroup?: boolean;
  endsGroup?: boolean;
  selectedReaction?: PostReaction | null;
  showReactions?: boolean;
  showTimestamp?: boolean;
  replyTarget?: ConversationMessage;
  replyTargetAuthor?: string;
  onViewReply?: () => void;
  anchorRef?: Ref<HTMLDivElement>;
}) {
  const reactions = new Map(
    message.reactions?.map(({ reaction, count }) => [reaction, count]) ?? [],
  );
  if (selectedReaction) {
    reactions.set(selectedReaction, (reactions.get(selectedReaction) ?? 0) + 1);
  }
  const messageBody = message.deleted ? "삭제된 메시지입니다" : message.body;
  const emojiGraphemes = getEmojiOnlyMessageGraphemes(messageBody);
  const isEmojiOnly = emojiGraphemes !== null;
  const hasReactions = showReactions && reactions.size > 0;
  const reactionCount = [...reactions.values()].reduce(
    (total, count) => total + count,
    0,
  );

  return (
    <div
      ref={anchorRef}
      className={cn(
        "relative w-fit max-w-full min-w-0",
        hasReactions && "mb-4",
      )}
    >
      <div
        className={cn(
          "w-full",
          isEmojiOnly
            ? "px-1 py-0.5 text-5xl leading-none"
            : "rounded-2xl px-3.5 py-2 text-[15px] [overflow-wrap:anywhere] break-keep whitespace-pre-wrap",
          !isEmojiOnly &&
            (isOwn
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"),
          !isEmojiOnly && !startsGroup && isOwn && "rounded-tr-md",
          !isEmojiOnly && !startsGroup && !isOwn && "rounded-tl-md",
          !isEmojiOnly && !endsGroup && isOwn && "rounded-br-md",
          !isEmojiOnly && !endsGroup && !isOwn && "rounded-bl-md",
        )}
      >
        {replyTarget && onViewReply ? (
          <button
            type="button"
            aria-label={`${replyTargetAuthor ?? "알 수 없는 사용자"}의 원문 메시지 보기`}
            className={cn(
              "mb-1.5 block w-full max-w-full min-w-0 border-l-2 pl-2 text-left text-xs leading-4",
              isOwn && !isEmojiOnly
                ? "border-primary-foreground/50 text-primary-foreground/85 hover:bg-primary-foreground/10"
                : "border-primary text-muted-foreground hover:bg-background/60",
            )}
            onClick={onViewReply}
          >
            <span className="block truncate font-semibold">
              {replyTargetAuthor ?? "알 수 없는 사용자"}
            </span>
            <span className="block truncate">
              {replyTarget.deleted ? "삭제된 메시지입니다" : replyTarget.body}
            </span>
          </button>
        ) : null}
        {isEmojiOnly ? (
          <EmojiOnlyMessageBody graphemes={emojiGraphemes} />
        ) : (
          <MessageBody body={messageBody} isOwn={isOwn} />
        )}
        {showTimestamp ? (
          <time
            className={cn(
              "mt-1 block text-right text-[10px] leading-none",
              !isEmojiOnly && isOwn
                ? "text-primary-foreground/75"
                : "text-muted-foreground",
            )}
          >
            {message.sentAt}
          </time>
        ) : null}
      </div>
      {hasReactions ? (
        <Badge
          variant="secondary"
          className={cn(
            "absolute top-full h-6 -translate-y-2 gap-1 rounded-full border-2 border-background px-1.5 text-[13px] shadow-none",
            isOwn ? "left-1" : "right-1",
          )}
        >
          {[...reactions].map(([reaction]) => (
            <span key={reaction} className="flex items-center">
              <ReactionEmoji
                reaction={reaction}
                labelled
                className="size-[13px]"
              />
            </span>
          ))}
          {reactionCount > 1 ? (
            <span
              className={cn(
                "font-normal",
                isOwn ? "text-primary-foreground/75" : "text-muted-foreground",
              )}
            >
              {reactionCount}
            </span>
          ) : null}
        </Badge>
      ) : null}
    </div>
  );
}

function EmojiOnlyMessageBody({ graphemes }: { graphemes: string[] }) {
  if (graphemes.length === 1 && graphemes[0] === "👍") {
    return (
      <span aria-label="좋아요" className="inline-flex text-primary">
        <ThumbsUpIcon aria-hidden className="size-[1em]" />
      </span>
    );
  }

  return <>{graphemes.join("")}</>;
}

function MessageBody({ body, isOwn }: { body: string; isOwn: boolean }) {
  return parseMessageText(body).map((segment, index) =>
    segment.type === "link" ? (
      <a
        key={`${segment.value}-${index}`}
        href={segment.value}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "underline underline-offset-2",
          isOwn ? "text-primary-foreground" : "text-primary",
        )}
      >
        {segment.value}
      </a>
    ) : (
      segment.value
    ),
  );
}
