import type { QueryClient } from "@tanstack/react-query";

import {
  flattenMessagePages,
  invalidateConversationList,
  invalidateUnreadMessageCount,
  isMessageWriteHeld,
  latestMessageChange,
  mergeServerMessages,
  messagingKeys,
  patchUnreadCounts,
  replaceConversationSummary,
  type MessagePages,
} from "~/features/messaging/data/cache";
import {
  getConversationSummary,
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
 * 다른 멤버가 읽었다. 메시지의 "읽지 않은 수"는 바뀐 시각에 잡히지 않으므로 최근 메시지의 수만 다시
 * 받는다. 그룹에서는 상대 메시지도 다른 멤버가 읽었는지 보여 준다.
 */
export async function refreshReadState(
  queryClient: QueryClient,
  conversationId: string,
): Promise<void> {
  const data = queryClient.getQueryData<MessagePages>(
    messagingKeys.messages(conversationId),
  );
  const ids = (data ? flattenMessagePages(data) : [])
    .filter(
      (message) =>
        !message.system &&
        !message.pending &&
        !message.failed &&
        !message.deleted,
    )
    .slice(-READ_COUNT_LIMIT)
    .map(({ id }) => id);
  const counts = await listMessageReadCounts(conversationId, ids);
  patchUnreadCounts(queryClient, conversationId, counts);
}

/**
 * 대화 목록에서 이 대화 한 줄만 다시 받는다. 목록 전체를 다시 읽으면 모든 대화의 마지막 메시지를
 * 복호화한다. 목록에 없던 대화(새로 초대된 대화)면 전체를 다시 읽는다.
 */
export async function refreshConversationInList(
  queryClient: QueryClient,
  conversationId: string,
): Promise<void> {
  const summary = await getConversationSummary(conversationId);
  if (!summary || !replaceConversationSummary(queryClient, summary)) {
    await invalidateConversationList(queryClient);
    return;
  }
  // 이 대화의 읽지 않은 수가 바뀌었으면 탭 배지도 바뀐다.
  void invalidateUnreadMessageCount(queryClient);
  // 새 메시지나 지운 메시지가 첨부를 더하거나 뺐을 수 있다.
  void queryClient.invalidateQueries({
    queryKey: messagingKeys.sharedAttachmentCounts(conversationId),
  });
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
      const cached = new Map(
        flattenMessagePages(data).map((message) => [message.id, message]),
      );
      const received = new Set(page.messages.map(({ id }) => id));
      // 보내는 중이거나 보내지 못한 내 메시지는 서버에 없으므로 그대로 둔다.
      const pending = [...cached.values()].filter(
        (message) =>
          (message.pending === true || message.failed === true) &&
          !received.has(message.id),
      );
      // 내 요청이 진행 중인 메시지는 이 스냅숏보다 cache가 새롭다.
      const messages = page.messages.map((message) =>
        isMessageWriteHeld(message.id)
          ? (cached.get(message.id) ?? message)
          : message,
      );
      return {
        pages: [{ ...page, messages: [...messages, ...pending] }],
        pageParams: [null],
      };
    },
  );
  queryClient.setQueryData(messagingKeys.pinned(conversationId), pinned);
}
