import {
  queryOptions,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";

import {
  getUnreadMessageCount,
  listConversations,
} from "~/features/messaging/data/queries";

import type {
  Conversation,
  ConversationMessage,
  ConversationSummary,
  MessageCursor,
  MessagePage,
  MessageReplyPreview,
} from "~/features/messaging/model/types";

export const messagingKeys = {
  all: ["messaging"] as const,
  conversations: () => [...messagingKeys.all, "conversations"] as const,
  messages: (conversationId: string) =>
    [...messagingKeys.all, "messages", conversationId] as const,
  pinned: (conversationId: string) =>
    [...messagingKeys.all, "pinned", conversationId] as const,
  unreadCount: () => [...messagingKeys.all, "unread-count"] as const,
  reactors: (messageId: string) =>
    [...messagingKeys.all, "reactors", messageId] as const,
  attachmentUrls: (paths: string[]) =>
    [...messagingKeys.all, "attachment-urls", ...paths] as const,
  sharedAttachments: (conversationId: string, media: boolean) =>
    [
      ...messagingKeys.all,
      "shared-attachments",
      conversationId,
      media ? "media" : "files",
    ] as const,
  sharedAttachmentCounts: (conversationId: string) =>
    [...messagingKeys.all, "shared-attachment-counts", conversationId] as const,
  recipients: (query: string) =>
    [...messagingKeys.all, "recipients", query] as const,
};

/**
 * 대화 목록. 데스크톱에서는 대화방 옆에 계속 떠 있으므로 loader 데이터가 아니라 이 cache를
 * 구독한다. 내 읽음과 전송은 무효화로 덮고, 다른 사람의 새 메시지는 `MessagingSync`가 Realtime
 * 신호로 무효화한다(기술 설계 §5).
 */
export function conversationListQuery() {
  return queryOptions({
    queryKey: messagingKeys.conversations(),
    queryFn: listConversations,
    staleTime: 2 * 60_000,
  });
}

/**
 * 대화 목록의 한 줄을 바꾸고 마지막 메시지 순서를 다시 잡는다. 목록이 아직 없거나 처음 보는 대화면
 * `false`를 돌려주며, 호출하는 쪽이 목록 전체를 다시 읽는다.
 */
export function replaceConversationSummary(
  queryClient: QueryClient,
  summary: ConversationSummary,
): boolean {
  let replaced = false;
  queryClient.setQueryData<ConversationSummary[]>(
    messagingKeys.conversations(),
    (list) => {
      if (!list?.some(({ id }) => id === summary.id)) return list;
      replaced = true;
      return list
        .map((item) => (item.id === summary.id ? summary : item))
        .sort(compareConversationOrder);
    },
  );
  return replaced;
}

/** 목록에서 이 대화를 뺀다. 스스로 나간 그룹은 서버도 목록에서 감춘다(기능 명세 §13.16). */
export function removeConversationFromList(
  queryClient: QueryClient,
  conversationId: string,
) {
  queryClient.setQueryData<ConversationSummary[]>(
    messagingKeys.conversations(),
    (list) => list?.filter(({ id }) => id !== conversationId),
  );
}

/** 목록의 이 대화를 읽음으로 그린다. 서버가 확정하면 `replaceConversationSummary`가 덮는다. */
export function markConversationListRead(
  queryClient: QueryClient,
  conversationId: string,
) {
  const cleared =
    queryClient
      .getQueryData<ConversationSummary[]>(messagingKeys.conversations())
      ?.find(({ id }) => id === conversationId)?.unreadCount ?? 0;
  queryClient.setQueryData<ConversationSummary[]>(
    messagingKeys.conversations(),
    (list) =>
      list?.map((item) =>
        item.id === conversationId && item.unreadCount > 0
          ? { ...item, unreadCount: 0 }
          : item,
      ),
  );
  // 탭 배지에서도 그만큼 뺀다. 서버 값은 이어지는 목록 갱신이 다시 읽는다.
  if (cleared > 0) {
    queryClient.setQueryData<number>(messagingKeys.unreadCount(), (count) =>
      count === undefined ? count : Math.max(0, count - cleared),
    );
  }
}

/** 서버 `list_conversations`의 순서. 최근 메시지가 위, 메시지가 없는 대화는 아래다. */
function compareConversationOrder(
  a: ConversationSummary,
  b: ConversationSummary,
): number {
  if (!a.lastMessage || !b.lastMessage) {
    return a.lastMessage ? -1 : b.lastMessage ? 1 : 0;
  }
  return (
    toMicroseconds(b.lastMessage.sentAt) - toMicroseconds(a.lastMessage.sentAt)
  );
}

/**
 * 메신저 탭 배지. 셸이 모든 화면에서 그리므로 대화 목록 전체가 아니라 이 수만 읽는다. 내 읽음과
 * 새 메시지 신호가 무효화한다.
 */
export function unreadMessageCountQuery() {
  return queryOptions({
    queryKey: messagingKeys.unreadCount(),
    queryFn: getUnreadMessageCount,
    staleTime: 60_000,
    // 배지를 못 읽는다고 화면이 멈출 이유는 없다. 다음 무효화에서 다시 시도한다.
    retry: false,
  });
}

/** 메신저 탭 배지를 다시 읽는다. */
export function invalidateUnreadMessageCount(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    queryKey: messagingKeys.unreadCount(),
  });
}

/** 내 읽음 위치나 마지막 메시지가 바뀌었다. 목록의 읽지 않은 수와 미리보기, 탭 배지를 다시 읽는다. */
export function invalidateConversationList(queryClient: QueryClient) {
  void invalidateUnreadMessageCount(queryClient);
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
/**
 * 최신 페이지 끝에 붙인다. 같은 ID가 이미 있으면 붙이지 않는다. 응답을 잃은 전송을 같은 ID로 다시
 * 보낼 때, 그사이 따라잡기가 서버 행을 먼저 넣었을 수 있다.
 */
export function appendMessage(
  queryClient: QueryClient,
  conversationId: string,
  message: ConversationMessage,
) {
  if (findCachedMessage(queryClient, conversationId, message.id)) return;
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
  updatePages(queryClient, conversationId, (messages) => {
    if (!messages.some(({ id }) => id === messageId)) return messages;
    const patched = messages.map((message) =>
      message.id === messageId ? { ...message, ...patch } : message,
    );
    // 전송 시각이 서버 값으로 확정되면 자리를 다시 잡는다. 초안은 기기 시계로 붙였으므로, 그새
    // 도착한 상대 메시지보다 뒤에 남아 있을 수 있다.
    return patch.sentAt ? patched.sort(compareMessageOrder) : patched;
  });
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
      return [...rest, next].sort(compareMessageOrder);
    },
  );
}

/** 이 메시지를 인용한 답장들의 인용을 고친다. 원문을 고치거나 지웠을 때 쓴다. */
export function patchReplyPreviews(
  queryClient: QueryClient,
  conversationId: string,
  messageId: string,
  patch: Partial<MessageReplyPreview>,
) {
  const update = (message: ConversationMessage) =>
    message.replyTo?.id === messageId
      ? { ...message, replyTo: { ...message.replyTo, ...patch } }
      : message;
  updatePages(queryClient, conversationId, (messages) => messages.map(update));
  queryClient.setQueryData<ConversationMessage[]>(
    messagingKeys.pinned(conversationId),
    (pinned) => pinned?.map(update),
  );
}

/** 대화 순서. 서버 정렬과 같은 `(sentAt, id)`다. */
export function compareMessageOrder(
  a: Pick<ConversationMessage, "sentAt" | "id">,
  b: Pick<ConversationMessage, "sentAt" | "id">,
): number {
  return (
    toMicroseconds(a.sentAt) - toMicroseconds(b.sentAt) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * ISO 시각을 마이크로초로. Postgres는 마이크로초까지 주는데 `Date.parse`는 밀리초에서 버려, 같은
 * 밀리초에 보낸 두 메시지의 순서가 서버와 달라진다.
 */
export function toMicroseconds(value: string): number {
  const match = /^(.*?)(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/.exec(value);
  if (!match) return Date.parse(value) * 1000;
  const [, base = "", fraction = "", zone = ""] = match;
  const micros = Number(fraction.slice(0, 6).padEnd(6, "0"));
  return Date.parse(base + zone) * 1000 + micros;
}

/**
 * 내 변경 요청이 진행 중인 메시지. 그동안 도착한 따라잡기 응답은 요청 전의 서버 상태일 수 있어 이
 * 메시지를 덮지 않는다. 요청이 끝나면 hook이 정본을 넣고, 그 변경의 신호가 다음 따라잡기를 부른다.
 */
const messageWrites = new Map<string, number>();

/** 이 메시지에 내 요청이 진행 중인지. 그동안의 서버 스냅숏은 이 메시지를 덮지 않는다. */
export function isMessageWriteHeld(messageId: string): boolean {
  return messageWrites.has(messageId);
}

/** 이 메시지에 대한 요청을 시작한다. 돌려준 함수를 요청이 끝날 때 부른다. */
export function holdMessageWrite(messageId: string): () => void {
  messageWrites.set(messageId, (messageWrites.get(messageId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (messageWrites.get(messageId) ?? 1) - 1;
    if (count > 0) messageWrites.set(messageId, count);
    else messageWrites.delete(messageId);
  };
}

/** 서버 행이 cache의 같은 메시지보다 낡지 않았고, 내 요청이 진행 중이지 않아 덮어도 되는지. */
function acceptsServerRow(
  current: ConversationMessage | undefined,
  row: ConversationMessage,
): boolean {
  if (messageWrites.has(row.id)) return false;
  if (!current?.changedAt || !row.changedAt) return true;
  return Date.parse(row.changedAt) >= Date.parse(current.changedAt);
}

/** 답장 인용에 담는 원문 길이. 서버 `private.message_rows`의 `reply_body`와 같다. */
export const REPLY_PREVIEW_LENGTH = 200;

/**
 * 서버가 준 정본 행을 cache에 합친다. 불러온 메시지는 같은 ID로 덮고, 처음 보는 메시지는 불러온
 * 구간 안에 들면 그 페이지에 순서대로 넣는다. 불러온 가장 오래된 메시지보다 앞서면 아직 읽지 않은
 * 페이지에 속하므로 그 페이지를 읽을 때 받는다. 이 메시지를 인용한 답장의 인용과 고정 목록도 함께
 * 고친다.
 */
export function mergeServerMessages(
  queryClient: QueryClient,
  conversationId: string,
  rows: ConversationMessage[],
) {
  if (rows.length === 0) return;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const accepted = new Map<string, ConversationMessage>();
  const quote = (message: ConversationMessage) => {
    const original = message.replyTo && accepted.get(message.replyTo.id);
    if (!original || !message.replyTo) return message;
    return {
      ...message,
      replyTo: {
        ...message.replyTo,
        body: original.deleted
          ? ""
          : original.body.slice(0, REPLY_PREVIEW_LENGTH),
        deleted: original.deleted,
        attachmentKind: original.deleted
          ? null
          : (original.attachments?.[0]?.kind ?? null),
      },
    };
  };

  queryClient.setQueryData<MessagePages>(
    messagingKeys.messages(conversationId),
    (data) => {
      if (!data) return data;
      const seen = new Set<string>();
      for (const page of data.pages) {
        for (const message of page.messages) {
          const row = byId.get(message.id);
          if (!row) continue;
          seen.add(message.id);
          if (acceptsServerRow(message, row)) accepted.set(row.id, row);
        }
      }
      const pages = data.pages.map((page) => ({
        ...page,
        messages: page.messages.map(
          (message) => accepted.get(message.id) ?? message,
        ),
      }));

      for (const row of rows) {
        if (seen.has(row.id) || messageWrites.has(row.id)) continue;
        // 첫 메시지가 이 행보다 앞서는 가장 최근 페이지가 이 행의 자리다. 맨 뒤 페이지 앞이
        // 대화의 처음이면 그 페이지에 넣는다.
        const index = pages.findIndex((page) => {
          const first = page.messages[0];
          return !first || compareMessageOrder(row, first) >= 0;
        });
        const lastIndex = pages.length - 1;
        const target =
          index !== -1
            ? index
            : pages[lastIndex]?.olderCursor === null
              ? lastIndex
              : -1;
        const page = pages[target];
        if (!page) continue;
        pages[target] = {
          ...page,
          messages: [...page.messages, row].sort(compareMessageOrder),
        };
        accepted.set(row.id, row);
      }

      return {
        ...data,
        pages: pages.map((page) => ({
          ...page,
          messages: page.messages.map(quote),
        })),
      };
    },
  );
  queryClient.setQueryData<ConversationMessage[]>(
    messagingKeys.pinned(conversationId),
    (pinned) => {
      if (!pinned) return pinned;
      const current = new Map(pinned.map((message) => [message.id, message]));
      const updates = rows.filter((row) =>
        acceptsServerRow(current.get(row.id), row),
      );
      const updated = new Set(updates.map(({ id }) => id));
      return [
        ...pinned.filter(({ id }) => !updated.has(id)),
        ...updates.filter((row) => row.pinned),
      ]
        .map(quote)
        .sort(compareMessageOrder);
    },
  );
}

/** 불러온 페이지의 내 메시지마다 "읽지 않은 수"를 서버 값으로 바꾼다. */
export function patchUnreadCounts(
  queryClient: QueryClient,
  conversationId: string,
  counts: Map<string, number>,
) {
  if (counts.size === 0) return;
  updatePages(queryClient, conversationId, (messages) =>
    messages.map((message) => {
      const count = counts.get(message.id);
      return count === undefined || count === message.unreadMemberCount
        ? message
        : { ...message, unreadMemberCount: count };
    }),
  );
}

/** 불러온 메시지 중 가장 늦게 바뀐 시각. 따라잡기의 기준이다. 아무것도 없으면 `null`이다. */
export function latestMessageChange(
  queryClient: QueryClient,
  conversationId: string,
): string | null {
  const data = queryClient.getQueryData<MessagePages>(
    messagingKeys.messages(conversationId),
  );
  const pinned =
    queryClient.getQueryData<ConversationMessage[]>(
      messagingKeys.pinned(conversationId),
    ) ?? [];
  let latest: string | null = null;
  for (const message of [
    ...(data ? flattenMessagePages(data) : []),
    ...pinned,
  ]) {
    if (
      message.changedAt &&
      (!latest || Date.parse(message.changedAt) > Date.parse(latest))
    ) {
      latest = message.changedAt;
    }
  }
  return latest;
}

/** 화면이 지금 구독하고 있는 대화방. 닫힌 방의 cache는 다시 열 때 loader가 새로 채운다. */
export function openConversationIds(queryClient: QueryClient): string[] {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: messagingKeys.all })
    .filter(
      (query) =>
        query.queryKey[1] === "messages" && query.getObserversCount() > 0,
    )
    .map((query) => String(query.queryKey[2]));
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
