import { toReactions } from "~/features/messaging/data/queries";
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

/** 내 반응을 정하거나 지우고(`null`), 서버가 확정한 집계를 돌려준다. */
export async function setMessageReaction(
  message: ConversationMessage,
  reaction: PostReaction | null,
): Promise<Pick<ConversationMessage, "reactions" | "myReaction">> {
  const { data, error } = await getSupabase().rpc("set_message_reaction", {
    p_message_id: message.id,
    p_reaction: reaction ?? undefined,
  });
  if (error) throw error;
  const saved = data?.[0];
  if (!saved) throw new Error("Reaction was not saved");

  return {
    reactions: toReactions(saved.reactions),
    myReaction: saved.my_reaction,
  };
}

export async function setMessagePinned(
  messageId: string,
  pinned: boolean,
): Promise<Pick<ConversationMessage, "pinned">> {
  const { error } = await getSupabase().rpc("set_message_pinned", {
    p_message_id: messageId,
    p_pinned: pinned,
  });
  if (error) throw error;
  return { pinned };
}

/** 보낸 지 15분 안의 내 메시지를 고친다. 서버가 정한 고친 시각을 돌려준다. */
export async function editMessage(
  messageId: string,
  body: string,
): Promise<Pick<ConversationMessage, "body" | "editedAt">> {
  const { data, error } = await getSupabase().rpc("edit_message", {
    p_message_id: messageId,
    p_body: body,
  });
  if (error) throw error;
  return { body, editedAt: data };
}

/** 1:1 대화를 연다. 같은 사람과 이미 대화가 있으면 그 대화의 ID를 돌려준다. */
export async function openDirectConversation(
  profileId: string,
): Promise<string> {
  const { data, error } = await getSupabase().rpc("open_direct_conversation", {
    p_profile_id: Number(profileId),
  });
  if (error) throw error;
  return data;
}

/** 그룹 대화를 만든다. 만든 사람은 자동으로 멤버가 된다. */
export async function createGroupConversation(
  name: string,
  profileIds: string[],
): Promise<string> {
  const { data, error } = await getSupabase().rpc("create_group_conversation", {
    p_name: name,
    p_profile_ids: profileIds.map(Number),
  });
  if (error) throw error;
  return data;
}

export async function addConversationMembers(
  conversationId: string,
  profileIds: string[],
): Promise<void> {
  const { error } = await getSupabase().rpc("add_conversation_members", {
    p_conversation_id: conversationId,
    p_profile_ids: profileIds.map(Number),
  });
  if (error) throw error;
}

export async function leaveConversation(conversationId: string): Promise<void> {
  const { error } = await getSupabase().rpc("leave_conversation", {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
}

export async function removeConversationMember(
  conversationId: string,
  profileId: string,
): Promise<void> {
  const { error } = await getSupabase().rpc("remove_conversation_member", {
    p_conversation_id: conversationId,
    p_profile_id: Number(profileId),
  });
  if (error) throw error;
}

export async function renameConversation(
  conversationId: string,
  name: string,
): Promise<void> {
  const { error } = await getSupabase().rpc("rename_conversation", {
    p_conversation_id: conversationId,
    p_name: name,
  });
  if (error) throw error;
}

/** 대화 알림을 끄거나 켠다. 끄면 직접 다시 켤 때까지 이 대화의 Push를 보내지 않는다. */
export async function setConversationMuted(
  conversationId: string,
  muted: boolean,
): Promise<void> {
  const { error } = await getSupabase().rpc("set_conversation_muted", {
    p_conversation_id: conversationId,
    p_muted: muted,
  });
  if (error) throw error;
}

/** 내 메시지를 지운다. 하나라도 내 메시지가 아니면 아무것도 지우지 않는다. */
export async function deleteMessages(messageIds: string[]): Promise<void> {
  const { error } = await getSupabase().rpc("delete_messages", {
    p_message_ids: messageIds,
  });
  if (error) throw error;
}

/** 보낸 사람이 첨부 하나를 지운다. 본문 없이 첨부만 있던 메시지의 마지막 첨부면 메시지도 지워진다. */
export async function removeMessageAttachment(
  attachmentId: string,
): Promise<void> {
  const { error } = await getSupabase().rpc("remove_message_attachment", {
    p_attachment_id: attachmentId,
  });
  if (error) throw error;
}
