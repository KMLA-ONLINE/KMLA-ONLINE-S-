import {
  queryOptions,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";

import { listConversations } from "~/features/messaging/data/queries";

import type {
  Conversation,
  ConversationMessage,
  MessageCursor,
  MessagePage,
} from "~/features/messaging/model/types";

export const messagingKeys = {
  all: ["messaging"] as const,
  conversations: () => [...messagingKeys.all, "conversations"] as const,
  messages: (conversationId: string) =>
    [...messagingKeys.all, "messages", conversationId] as const,
  pinned: (conversationId: string) =>
    [...messagingKeys.all, "pinned", conversationId] as const,
};

/**
 * 대화 목록. 데스크톱에서는 대화방 옆에 계속 떠 있으므로 loader 데이터가 아니라 이 cache를
 * 구독한다. 내 읽음과 전송은 무효화로 덮는다. 다른 사람의 새 메시지는 Realtime이 맡을 것이다
 * (기술 설계 §5).
 */
export function conversationListQuery() {
  return queryOptions({
    queryKey: messagingKeys.conversations(),
    queryFn: listConversations,
    staleTime: 2 * 60_000,
  });
}

/** 내 읽음 위치나 마지막 메시지가 바뀌었다. 목록의 읽지 않은 수와 미리보기를 다시 읽는다. */
export function invalidateConversationList(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    queryKey: messagingKeys.conversations(),
  });
}

/** 첫 페이지가 최신, 뒤로 갈수록 오래된 페이지다. 페이지 안은 오래된 것부터다. */
export type MessagePages = InfiniteData<MessagePage, MessageCursor | null>;

export function initialMessagePages(conversation: Conversation): MessagePages {
  return {
    pages: [
      {
        messages: conversation.messages,
        olderCursor: conversation.olderCursor,
      },
    ],
    pageParams: [null],
  };
}

/**
 * 대화방 loader가 방금 받은 값으로 cache를 덮는다. 메시지 cache는 시간으로 낡지 않으므로
 * (`staleTime: Infinity`) 덮지 않으면 다시 들어온 방이 이전 방문 때의 메시지를 그대로 보여 준다.
 * 이어 붙였던 앞선 페이지도 버리고 최신 페이지부터 다시 시작한다.
 */
export function seedConversationCache(
  queryClient: QueryClient,
  conversation: Conversation,
) {
  queryClient.setQueryData<MessagePages>(
    messagingKeys.messages(conversation.id),
    initialMessagePages(conversation),
  );
  queryClient.setQueryData<ConversationMessage[]>(
    messagingKeys.pinned(conversation.id),
    conversation.pinnedMessages,
  );
}

/** 화면에 그릴 순서(오래된 것부터)로 펼친다. */
export function flattenMessagePages(data: {
  pages: MessagePage[];
}): ConversationMessage[] {
  return [...data.pages].reverse().flatMap((page) => page.messages);
}

export function findCachedMessage(
  queryClient: QueryClient,
  conversationId: string,
  messageId: string,
): ConversationMessage | undefined {
  const data = queryClient.getQueryData<MessagePages>(
    messagingKeys.messages(conversationId),
  );
  for (const page of data?.pages ?? []) {
    const message = page.messages.find(({ id }) => id === messageId);
    if (message) return message;
  }
  return queryClient
    .getQueryData<ConversationMessage[]>(messagingKeys.pinned(conversationId))
    ?.find(({ id }) => id === messageId);
}

function updatePages(
  queryClient: QueryClient,
  conversationId: string,
  update: (
    messages: ConversationMessage[],
    pageIndex: number,
  ) => ConversationMessage[],
) {
  queryClient.setQueryData<MessagePages>(
    messagingKeys.messages(conversationId),
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page, index) => ({
          ...page,
          messages: update(page.messages, index),
        })),
      },
  );
}

/** 최신 페이지 끝에 붙인다. */
export function appendMessage(
  queryClient: QueryClient,
  conversationId: string,
  message: ConversationMessage,
) {
  updatePages(queryClient, conversationId, (messages, index) =>
    index === 0 ? [...messages, message] : messages,
  );
}

/**
 * 불러온 페이지와 고정 메시지 목록 양쪽의 같은 메시지를 고친다. `pinned`가 바뀌면 고정 목록에
 * 넣거나 빼며, 고정 목록은 대화 순서를 유지한다.
 */
export function patchMessage(
  queryClient: QueryClient,
  conversationId: string,
  messageId: string,
  patch: Partial<ConversationMessage>,
) {
  updatePages(queryClient, conversationId, (messages) =>
    messages.map((message) =>
      message.id === messageId ? { ...message, ...patch } : message,
    ),
  );
  queryClient.setQueryData<ConversationMessage[]>(
    messagingKeys.pinned(conversationId),
    (pinned) => {
      if (!pinned) return pinned;
      const current =
        pinned.find(({ id }) => id === messageId) ??
        findCachedMessage(queryClient, conversationId, messageId);
      if (!current) return pinned;

      const next = { ...current, ...patch };
      const rest = pinned.filter(({ id }) => id !== messageId);
      if (!next.pinned) return rest;
      return [...rest, next].sort(
        (a, b) =>
          Date.parse(a.sentAt) - Date.parse(b.sentAt) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    },
  );
}

export function removeMessage(
  queryClient: QueryClient,
  conversationId: string,
  messageId: string,
) {
  updatePages(queryClient, conversationId, (messages) =>
    messages.filter(({ id }) => id !== messageId),
  );
}
