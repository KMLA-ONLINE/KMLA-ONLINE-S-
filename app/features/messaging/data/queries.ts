import { mockConversations } from "~/features/messaging/model/mock";
import type {
  Conversation,
  ConversationSummary,
} from "~/features/messaging/model/types";

export function listConversations(): Promise<ConversationSummary[]> {
  return Promise.resolve(
    mockConversations.map(({ messages: _messages, ...conversation }) =>
      structuredClone(conversation),
    ),
  );
}

export function loadConversation(
  conversationId: string,
): Promise<Conversation | null> {
  const conversation = mockConversations.find(
    ({ id }) => id === conversationId,
  );
  return Promise.resolve(conversation ? structuredClone(conversation) : null);
}
