import { applyMessageReaction } from "~/features/messaging/model/message-reactions";
import type { ConversationMessage } from "~/features/messaging/model/types";
import type { PostReaction } from "~/features/posts/model/types";

// 메시지 RPC가 생기기 전의 자리다(docs/MESSAGING_TECHNICAL_DESIGN.md §3). 서버가 확정해 돌려줄
// 정본 모양만 흉내 내고 아무것도 저장하지 않으므로, 새로고침하면 보낸 내용이 사라진다.
// RPC가 생기면 시그니처는 두고 본문만 바꾼다.

export interface SendMessageInput {
  conversationId: string;
  /** 클라이언트가 만든 UUID. 같은 값으로 다시 보내면 서버가 한 번만 저장한다. */
  id: string;
  body: string;
  replyToMessageId?: string;
}

export function sendMessage(
  input: SendMessageInput,
  draft: ConversationMessage,
): Promise<ConversationMessage> {
  return Promise.resolve({ ...draft, id: input.id, body: input.body });
}

export function setMessageReaction(
  message: ConversationMessage,
  reaction: PostReaction | null,
): Promise<Pick<ConversationMessage, "reactions" | "myReaction">> {
  return Promise.resolve(applyMessageReaction(message, reaction));
}

export function setMessagePinned(
  _messageId: string,
  pinned: boolean,
): Promise<Pick<ConversationMessage, "pinned">> {
  return Promise.resolve({ pinned });
}
