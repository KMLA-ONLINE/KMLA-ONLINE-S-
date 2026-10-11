import type { ConversationSummary } from "~/features/messaging/model/types";

/** 대화 목록의 마지막 메시지 한 줄. 그룹 대화에서 남이 보낸 메시지에는 발신자 이름을 붙인다. */
export function formatLastMessagePreview(
  conversation: Pick<
    ConversationSummary,
    "type" | "participants" | "viewerId" | "lastMessage"
  >,
): string {
  const { lastMessage } = conversation;
  if (!lastMessage) return "";
  if (
    conversation.type !== "group" ||
    !lastMessage.senderId ||
    lastMessage.senderId === conversation.viewerId
  ) {
    return lastMessage.body;
  }

  const sender = conversation.participants.find(
    ({ id }) => id === lastMessage.senderId,
  );
  return sender ? `${sender.name}: ${lastMessage.body}` : lastMessage.body;
}
