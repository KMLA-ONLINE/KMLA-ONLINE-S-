import type { PostReaction } from "~/features/posts/model/types";
import type { ConversationMessage } from "~/features/messaging/model/types";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";

const MESSAGE_REACTION_EMOJI = {
  like: "👍",
  love: "❤️",
  haha: "😆",
  wow: "😮",
  sad: "😢",
  angry: "😠",
} satisfies Record<PostReaction, string>;

export function MessageBubble({
  message,
  isOwn,
  startsGroup = true,
  endsGroup = true,
  selectedReaction,
  showReactions = true,
}: {
  message: ConversationMessage;
  isOwn: boolean;
  startsGroup?: boolean;
  endsGroup?: boolean;
  selectedReaction?: PostReaction | null;
  showReactions?: boolean;
}) {
  const reactions = new Map(
    message.reactions?.map(({ emoji, count }) => [emoji, count]) ?? [],
  );
  if (selectedReaction) {
    const emoji = MESSAGE_REACTION_EMOJI[selectedReaction];
    reactions.set(emoji, (reactions.get(emoji) ?? 0) + 1);
  }

  return (
    <div className="relative min-w-0">
      <div
        className={cn(
          "rounded-2xl px-3.5 py-2 text-sm break-words break-keep whitespace-pre-wrap",
          isOwn
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
          !startsGroup && isOwn && "rounded-tr-md",
          !startsGroup && !isOwn && "rounded-tl-md",
          !endsGroup && isOwn && "rounded-br-md",
          !endsGroup && !isOwn && "rounded-bl-md",
        )}
      >
        <MessageBody body={message.body} isOwn={isOwn} />
        <time
          className={cn(
            "mt-1 block text-right text-[10px] leading-none",
            isOwn ? "text-primary-foreground/75" : "text-muted-foreground",
          )}
        >
          {message.sentAt}
        </time>
      </div>
      {showReactions && reactions.size ? (
        <Badge
          variant="secondary"
          className={cn(
            "absolute -bottom-3 h-6 gap-1 rounded-full border border-background px-1.5 shadow-sm",
            isOwn ? "right-1" : "left-1",
          )}
        >
          {[...reactions].map(([emoji, count]) => (
            <span key={emoji}>
              {emoji} {count}
            </span>
          ))}
        </Badge>
      ) : null}
    </div>
  );
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
