// 메시지 data 모듈(`data/queries.ts`, `data/mutations.ts`)을 대신하는 테스트용 구현. 서버 대신
// `mock-data.ts`를 읽고 아무것도 저장하지 않는다. 화면과 hook 테스트가 `vi.mock`으로 끼운다.
//
//   vi.mock("~/features/messaging/data/queries", () => import("../fake-api"));
//   vi.mock("~/features/messaging/data/mutations", () => import("../fake-api"));

import { applyMessageReaction } from "~/features/messaging/model/message-reactions";
import type {
  Conversation,
  ConversationMessage,
  ConversationSummary,
  MessageCursor,
  MessagePage,
} from "~/features/messaging/model/types";
import type { PostReaction } from "~/features/posts/model/types";

import { mockConversations, type MockMessage } from "./mock-data";

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

/** 대화 정보, 최신 메시지 한 페이지와 고정 메시지 전체. 대화방 첫 화면의 유일한 요청이다. */
export function loadConversation(
  conversationId: string,
  limit = MESSAGE_PAGE_SIZE,
): Promise<Conversation | null> {
  const conversation = findConversation(conversationId);
  if (!conversation) return Promise.resolve(null);

  const { messages, ...rest } = conversation;
  return Promise.resolve(
    structuredClone({
      ...rest,
      ...pageBefore(messages, null, limit),
      pinnedMessages: messages
        .filter((message) => message.pinned && !message.system)
        .map((message) => withReplyPreview(message, messages)),
    }),
  );
}

/** `before`보다 앞선 메시지 한 페이지. `before`가 없으면 최신 페이지다. */
export function listMessages(
  conversationId: string,
  before: MessageCursor | null,
  limit = MESSAGE_PAGE_SIZE,
): Promise<MessagePage> {
  return Promise.resolve(
    structuredClone(
      pageBefore(
        findConversation(conversationId)?.messages ?? [],
        before,
        limit,
      ),
    ),
  );
}

export function listPinnedMessages(
  conversationId: string,
): Promise<ConversationMessage[]> {
  const messages = findConversation(conversationId)?.messages ?? [];
  return Promise.resolve(
    structuredClone(
      messages
        .filter((message) => message.pinned && !message.system)
        .map((message) => withReplyPreview(message, messages)),
    ),
  );
}

function findConversation(conversationId: string) {
  return mockConversations.find(({ id }) => id === conversationId);
}

/** `(sentAt, id)` 순서. 실제 RPC의 정렬·커서 비교와 같은 규칙이다. */
function compareCursor(a: MessageCursor, b: MessageCursor): number {
  const time = Date.parse(a.sentAt) - Date.parse(b.sentAt);
  if (time !== 0) return time;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 커서 행을 찾지 않고 비교로 자른다. 커서가 가리키던 메시지가 그새 사라져도 그보다 앞선 메시지만
 * 정확히 돌려준다.
 */
function pageBefore(
  messages: MockMessage[],
  before: MessageCursor | null,
  limit: number,
): MessagePage {
  const older = before
    ? messages.filter((message) => compareCursor(message, before) < 0)
    : messages;
  const start = Math.max(0, older.length - limit);
  const first = older[start];

  return {
    messages: older
      .slice(start)
      .map((message) => withReplyPreview(message, messages)),
    olderCursor:
      start > 0 && first ? { sentAt: first.sentAt, id: first.id } : null,
  };
}

function withReplyPreview(
  { replyToMessageId, ...message }: MockMessage,
  messages: MockMessage[],
): ConversationMessage {
  const original = replyToMessageId
    ? messages.find(({ id }) => id === replyToMessageId)
    : undefined;
  if (!original) return message;

  return {
    ...message,
    replyTo: {
      id: original.id,
      senderId: original.senderId,
      body: original.deleted ? "" : original.body,
      deleted: original.deleted,
    },
  };
}

export interface SendMessageInput {
  conversationId: string;
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

export function markConversationRead(
  _conversationId: string,
  _messageId: string,
): Promise<void> {
  return Promise.resolve();
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

export function editMessage(
  _messageId: string,
  body: string,
): Promise<Pick<ConversationMessage, "body" | "editedAt">> {
  return Promise.resolve({ body, editedAt: new Date().toISOString() });
}

export function deleteMessages(_messageIds: string[]): Promise<void> {
  return Promise.resolve();
}
