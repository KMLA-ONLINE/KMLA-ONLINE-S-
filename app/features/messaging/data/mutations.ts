import { applyMessageReaction } from "~/features/messaging/model/message-reactions";
import type { ConversationMessage } from "~/features/messaging/model/types";
import type { PostReaction } from "~/features/posts/model/types";
import { getSupabase } from "~/shared/supabase/client";

export interface SendMessageInput {
  conversationId: string;
  /** 클라이언트가 만든 UUID. 같은 값으로 다시 보내면 서버가 한 번만 저장한다. */
  id: string;
  body: string;
  replyToMessageId?: string;
}

/** 서버가 정한 전송 시각으로 초안을 확정한다. 본문 끝의 줄바꿈은 보내기 전에 화면이 이미 지운다. */
export async function sendMessage(
  input: SendMessageInput,
  draft: ConversationMessage,
): Promise<ConversationMessage> {
  const { data, error } = await getSupabase().rpc("send_message", {
    p_conversation_id: input.conversationId,
    p_message_id: input.id,
    p_body: input.body,
    p_reply_to_id: input.replyToMessageId,
  });
  if (error) throw error;
  const saved = data?.[0];
  if (!saved) throw new Error("Message was not saved");

  return { ...draft, id: saved.id, body: input.body, sentAt: saved.sent_at };
}

/** 읽음 위치를 이 메시지로 옮긴다. 서버는 앞으로만 옮기므로 순서가 뒤바뀐 요청도 안전하다. */
export async function markConversationRead(
  conversationId: string,
  messageId: string,
): Promise<void> {
  const { error } = await getSupabase().rpc("mark_conversation_read", {
    p_conversation_id: conversationId,
    p_message_id: messageId,
  });
  if (error) throw error;
}

// 반응과 고정은 아직 저장하지 않는다(기술 설계 §3의 다음 단계). 서버가 확정해 돌려줄 정본 모양만
// 흉내 내므로 새로고침하면 사라진다. RPC가 생기면 시그니처는 두고 본문만 바꾼다.

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
