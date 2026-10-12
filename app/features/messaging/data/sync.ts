import type { QueryClient } from "@tanstack/react-query";

import {
  flattenMessagePages,
  latestMessageChange,
  mergeServerMessages,
  messagingKeys,
  patchUnreadCounts,
  type MessagePages,
} from "~/features/messaging/data/cache";
import {
  listMessageChanges,
  listMessageReadCounts,
  listMessages,
  listPinnedMessages,
} from "~/features/messaging/data/queries";

/** 아무것도 불러오지 않은 방의 따라잡기 기준. 서버가 바뀐 시각 순서로 한도까지 준다. */
const EMPTY_ROOM_SINCE = "1970-01-01T00:00:00Z";

/** 읽음 표시를 고칠 내 메시지 수. 읽음 표시는 최근 메시지에서만 의미가 있다. */
const READ_COUNT_LIMIT = 100;

/**
 * 열린 대화방을 서버와 맞춘다(기술 설계 §5). 마지막으로 본 변경 이후의 메시지만 받아 합친다. 바뀐
 * 메시지가 한 번에 받을 수 있는 수를 넘으면 최신 페이지부터 다시 읽는다.
 */
export async function catchUpConversation(
  queryClient: QueryClient,
  conversationId: string,
): Promise<void> {
  const since =
    latestMessageChange(queryClient, conversationId) ?? EMPTY_ROOM_SINCE;
  const changes = await listMessageChanges(conversationId, since);
  if (changes.complete) {
    mergeServerMessages(queryClient, conversationId, changes.messages);
    return;
  }
  await reloadLatestPage(queryClient, conversationId);
}

/**
 * 다른 멤버가 읽었다. 내 메시지의 "읽지 않은 수"는 바뀐 시각에 잡히지 않으므로 최근 내 메시지의 수만
 * 다시 받는다.
 */
export async function refreshReadState(
  queryClient: QueryClient,
  conversationId: string,
  viewerId: string,
): Promise<void> {
  const data = queryClient.getQueryData<MessagePages>(
    messagingKeys.messages(conversationId),
  );
  const ids = (data ? flattenMessagePages(data) : [])
    .filter(
      (message) =>
        message.senderId === viewerId && !message.pending && !message.deleted,
    )
    .slice(-READ_COUNT_LIMIT)
    .map(({ id }) => id);
  const counts = await listMessageReadCounts(conversationId, ids);
  patchUnreadCounts(queryClient, conversationId, counts);
}

async function reloadLatestPage(
  queryClient: QueryClient,
  conversationId: string,
) {
  const [page, pinned] = await Promise.all([
    listMessages(conversationId, null),
    listPinnedMessages(conversationId),
  ]);
  // 이어 붙였던 앞선 페이지와 그 사이의 빈 구간을 함께 버린다. 아직 서버가 확정하지 않은 내
  // 메시지는 새 페이지에 없으므로 그대로 둔다. 확정되면 전송이 그 자리를 고친다.
  queryClient.setQueryData<MessagePages>(
    messagingKeys.messages(conversationId),
    (data) => {
      if (!data) return data;
      const received = new Set(page.messages.map(({ id }) => id));
      const pending = flattenMessagePages(data).filter(
        (message) => message.pending && !received.has(message.id),
      );
      return {
        pages: [{ ...page, messages: [...page.messages, ...pending] }],
        pageParams: [null],
      };
    },
  );
  queryClient.setQueryData(messagingKeys.pinned(conversationId), pinned);
}
