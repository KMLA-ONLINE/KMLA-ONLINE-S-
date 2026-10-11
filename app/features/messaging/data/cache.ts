import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import type {
  ConversationMessage,
  MessageCursor,
  MessagePage,
} from "~/features/messaging/model/types";

export const messagingKeys = {
  all: ["messaging"] as const,
  messages: (conversationId: string) =>
    [...messagingKeys.all, "messages", conversationId] as const,
};

/** 첫 페이지가 최신, 뒤로 갈수록 오래된 페이지다. 페이지 안은 오래된 것부터다. */
export type MessagePages = InfiniteData<MessagePage, MessageCursor | null>;

/** 화면에 그릴 순서(오래된 것부터)로 펼친다. */
export function flattenMessagePages(data: {
  pages: MessagePage[];
}): ConversationMessage[] {
  return [...data.pages].reverse().flatMap((page) => page.messages);
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
