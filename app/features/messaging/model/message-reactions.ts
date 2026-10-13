import type {
  ConversationMessage,
  MessageReaction,
} from "~/features/messaging/model/types";
import type { PostReaction } from "~/features/posts/model/types";

/**
 * 내 반응을 `next`로 바꾼 뒤의 반응 집계. 서버 정본이 오기 전에 앞서 그리는 데 쓴다.
 * 내 이전 반응은 한 개 빼고 새 반응을 한 개 더하며, 0이 된 종류는 지운다.
 */
export function applyMessageReaction(
  message: Pick<ConversationMessage, "reactions" | "myReaction">,
  next: PostReaction | null,
): Pick<ConversationMessage, "reactions" | "myReaction"> {
  const counts = new Map(
    (message.reactions ?? []).map(({ reaction, count }) => [reaction, count]),
  );
  const previous = message.myReaction ?? null;
  if (previous) counts.set(previous, (counts.get(previous) ?? 0) - 1);
  if (next) counts.set(next, (counts.get(next) ?? 0) + 1);

  const reactions: MessageReaction[] = [...counts]
    .filter(([, count]) => count > 0)
    .map(([reaction, count]) => ({ reaction, count }));

  return { reactions, myReaction: next };
}
