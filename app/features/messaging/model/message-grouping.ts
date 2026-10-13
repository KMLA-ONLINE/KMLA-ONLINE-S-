import { isSameMessageMinute } from "~/features/messaging/model/message-time";
import type { ConversationMessage } from "~/features/messaging/model/types";

export function hasVisibleMessageReaction(
  message: ConversationMessage,
): boolean {
  return Boolean(message.reactions?.some(({ count }) => count > 0));
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
    isSameMessageMinute(previous.sentAt, next.sentAt) &&
    !next.pinned &&
    !previousHasReaction
  );
}
