import type { ConversationMessage } from "~/features/messaging/model/types";
import type { PostReaction } from "~/features/posts/model/types";

export function hasVisibleMessageReaction(
  message: ConversationMessage,
  selectedReaction?: PostReaction | null,
): boolean {
  return (
    Boolean(selectedReaction) ||
    Boolean(message.reactions?.some(({ count }) => count > 0))
  );
}

export function canConnectMessages(
  previous: ConversationMessage | undefined,
  next: ConversationMessage | undefined,
  previousHasReaction = false,
): boolean {
  if (!previous || !next || previous.system || next.system) return false;

  return (
    previous.senderId !== null &&
    previous.senderId === next.senderId &&
    previous.sentAt === next.sentAt &&
    !next.dayLabel &&
    !previousHasReaction
  );
}
