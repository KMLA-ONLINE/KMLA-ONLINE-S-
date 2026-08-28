import { ThumbsUpIcon } from "lucide-react";

import { getEmojiOnlyMessageGraphemes } from "~/features/messaging/model/message-text";
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
}: {
  message: ConversationMessage;
  isOwn: boolean;
  startsGroup?: boolean;
  endsGroup?: boolean;
  selectedReaction?: PostReaction | null;
  showReactions?: boolean;
  showTimestamp?: boolean;
}) {
  const reactions = new Map(
    message.reactions?.map(({ reaction, count }) => [reaction, count]) ?? [],
  );
  if (selectedReaction) {
    reactions.set(selectedReaction, (reactions.get(selectedReaction) ?? 0) + 1);
  }
  const emojiGraphemes = getEmojiOnlyMessageGraphemes(message.body);
  const isEmojiOnly = emojiGraphemes !== null;
  const hasReactions = showReactions && reactions.size > 0;
  const reactionCount = [...reactions.values()].reduce(
    (total, count) => total + count,
    0,
  );

  return (
    <div className={cn("relative min-w-0", hasReactions && "mb-4")}>
      <div
        className={cn(
          isEmojiOnly
            ? "px-1 py-0.5 text-4xl leading-none"
            : "rounded-2xl px-3.5 py-2 text-sm break-words break-keep whitespace-pre-wrap",
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
        {isEmojiOnly ? (
          <EmojiOnlyMessageBody graphemes={emojiGraphemes} />
        ) : (
          <MessageBody body={message.body} isOwn={isOwn} />
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

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

function MessageBody({ body, isOwn }: { body: string; isOwn: boolean }) {
  return body.split(URL_PATTERN).map((part, index) =>
    part.startsWith("http://") || part.startsWith("https://") ? (
      <a
        key={`${part}-${index}`}
        href={part}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "underline underline-offset-2",
          isOwn ? "text-primary-foreground" : "text-primary",
        )}
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}
