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

/** 다시 읽은 목록이 읽은 상태를 보이도록 목 데이터를 고친다. */
export function markConversationRead(
  conversationId: string,
  _messageId: string,
): Promise<void> {
  const conversation = findConversation(conversationId);
  if (conversation) conversation.unreadCount = 0;
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

/** 목록이 정본이므로 다시 읽었을 때 바뀐 값이 보이도록 목 데이터를 고친다. */
export function setConversationMuted(
  conversationId: string,
  muted: boolean,
): Promise<void> {
  const conversation = findConversation(conversationId);
  if (conversation) conversation.muted = muted;
  return Promise.resolve();
}

export async function getConversationSummary(
  conversationId: string,
): Promise<ConversationSummary | null> {
  return (
    (await listConversations()).find(({ id }) => id === conversationId) ?? null
  );
}

const recipients = [
  { id: "seo", name: "박서현", avatarUrl: null, description: "29기 학생" },
  { id: "new-1", name: "최새봄", avatarUrl: null, description: "30기 학생" },
  { id: "new-2", name: "정여름", avatarUrl: null, description: "선생님" },
];

export function searchMessageRecipients(query: string) {
  const term = query.replace(/\s+/g, "");
  return Promise.resolve(
    term ? recipients.filter(({ name }) => name.includes(term)) : [],
  );
}

export function openDirectConversation(_profileId: string): Promise<string> {
  return Promise.resolve("hyunwoo");
}

export function createGroupConversation(
  _name: string,
  _profileIds: string[],
): Promise<string> {
  return Promise.resolve("student-council");
}

export function addConversationMembers(
  conversationId: string,
  profileIds: string[],
): Promise<void> {
  setActive(conversationId, profileIds, true);
  return Promise.resolve();
}

/** 다시 읽은 목록이 나간 상태를 보이도록 목 데이터를 고친다. */
export function leaveConversation(conversationId: string): Promise<void> {
  const viewerId = findConversation(conversationId)?.viewerId;
  if (viewerId) setActive(conversationId, [viewerId], false);
  return Promise.resolve();
}

export function removeConversationMember(
  conversationId: string,
  profileId: string,
): Promise<void> {
  setActive(conversationId, [profileId], false);
  return Promise.resolve();
}

// 참여자 객체는 대화끼리 같은 것을 쓸 수 있다(viewer). 고치지 않고 새로 만든다.
function setActive(conversationId: string, ids: string[], active: boolean) {
  const conversation = findConversation(conversationId);
  if (!conversation) return;
  conversation.participants = conversation.participants.map((participant) =>
    ids.includes(participant.id) ? { ...participant, active } : participant,
  );
}

const initialConversations = structuredClone(mockConversations);

/** 테스트가 고친 목 데이터를 처음 상태로 되돌린다. */
export function resetFakeMessaging() {
  mockConversations.splice(
    0,
    mockConversations.length,
    ...structuredClone(initialConversations),
  );
}

export function renameConversation(
  conversationId: string,
  name: string,
): Promise<void> {
  const conversation = findConversation(conversationId);
  if (conversation) conversation.name = name;
  return Promise.resolve();
}

/** 본문 부분 일치. 실제 서버처럼 공백과 대소문자를 무시하고 최신부터 준다. */
export function searchMessages(
  conversationId: string,
  query: string,
  _before: MessageCursor | null,
) {
  const term = query.replace(/\s+/g, "").toLowerCase();
  const messages = findConversation(conversationId)?.messages ?? [];
  return Promise.resolve({
    results: messages
      .filter(
        (message) =>
          !message.system &&
          !message.deleted &&
          message.body.replace(/\s+/g, "").toLowerCase().includes(term),
      )
      .reverse()
      .map(({ id, senderId, body, sentAt }) => ({
        id,
        senderId,
        body,
        sentAt,
      })),
    nextCursor: null,
  });
}

export function listMessageReactors(_messageId: string) {
  return Promise.resolve([
    {
      id: "seo",
      name: "박서현",
      avatarUrl: null,
      reaction: "like" as const,
      reactedAt: "2026-08-28T15:13:00+09:00",
    },
  ]);
}

export function getSharedAttachmentCounts(_conversationId: string) {
  return Promise.resolve({ media: 0, files: 0 });
}

export function listSharedAttachments() {
  return Promise.resolve({ items: [], nextCursor: null });
}

export function removeMessageAttachment(_attachmentId: string): Promise<void> {
  return Promise.resolve();
}
