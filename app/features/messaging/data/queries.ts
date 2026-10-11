import { mockConversations } from "~/features/messaging/model/mock";
import type {
  Conversation,
  ConversationMessage,
  ConversationSummary,
  MessageCursor,
  MessagePage,
} from "~/features/messaging/model/types";

export const MESSAGE_PAGE_SIZE = 50;

export function listConversations(): Promise<ConversationSummary[]> {
  return Promise.resolve(
    mockConversations.map(
      ({
        messages: _messages,
        sharedMediaCount: _media,
        sharedFileCount: _files,
        sharedLinkCount: _links,
        ...conversation
      }) => structuredClone(conversation),
    ),
  );
}

/** 대화 정보와 최신 메시지 한 페이지. 대화방 첫 화면의 유일한 요청이다. */
export function loadConversation(
  conversationId: string,
  limit = MESSAGE_PAGE_SIZE,
): Promise<Conversation | null> {
  const conversation = mockConversations.find(
    ({ id }) => id === conversationId,
  );
  if (!conversation) return Promise.resolve(null);

  const { messages, ...rest } = conversation;
  return Promise.resolve(
    structuredClone({ ...rest, ...pageBefore(messages, null, limit) }),
  );
}

/** `before`보다 앞선 메시지 한 페이지. `before`가 없으면 최신 페이지다. */
export function listMessages(
  conversationId: string,
  before: MessageCursor | null,
  limit = MESSAGE_PAGE_SIZE,
): Promise<MessagePage> {
  const conversation = mockConversations.find(
    ({ id }) => id === conversationId,
  );
  return Promise.resolve(
    structuredClone(pageBefore(conversation?.messages ?? [], before, limit)),
  );
}

function pageBefore(
  messages: ConversationMessage[],
  before: MessageCursor | null,
  limit: number,
): MessagePage {
  const end = before
    ? messages.findIndex(({ id }) => id === before.id)
    : messages.length;
  const start = Math.max(0, end - limit);
  const first = messages[start];

  return {
    messages: messages.slice(start, end),
    olderCursor:
      start > 0 && first ? { sentAt: first.sentAt, id: first.id } : null,
  };
}
