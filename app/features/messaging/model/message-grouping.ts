import type { ConversationMessage } from "~/features/messaging/model/types";
import type { PostReaction } from "~/features/posts/model/types";

const dayLabelFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

export function dayLabelFor(date: Date): string {
  return dayLabelFormatter.format(date);
}

export function nextMessageDayLabel(
  messages: ConversationMessage[],
  sentAt: Date,
): string | undefined {
  let previousDayLabel: string | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const dayLabel = messages[index]?.dayLabel;
    if (dayLabel) {
      previousDayLabel = dayLabel;
      break;
    }
  }
  const dayLabel = dayLabelFor(sentAt);

  return previousDayLabel === dayLabel ? undefined : dayLabel;
}

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
    !next.pinned &&
    !previousHasReaction
  );
}
