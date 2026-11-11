import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  findCachedConversation,
  invalidateConversationList,
  replaceConversationSummary,
} from "~/features/messaging/data/cache";
import { setConversationPinned } from "~/features/messaging/data/mutations";
import { refreshConversationInList } from "~/features/messaging/data/sync";
import type { ConversationSummary } from "~/features/messaging/model/types";

/**
 * 대화를 내 목록 맨 위에 고정하거나 푼다(기능 명세 §13.2). 목록을 먼저 다시 정렬해 그리고, 서버가
 * 거부하면 고정 표시만 되돌린다. 성공하면 그 대화 한 줄을 다시 읽는다.
 */
export function usePinConversation() {
  const queryClient = useQueryClient();

  // 렌더 시점의 prop이 아니라 캐시의 최신 행을 고친다. 그사이 실시간으로 온 마지막 메시지·안 읽음 수를
  // 덮어쓰지 않게 한다.
  const setPinned = (conversation: ConversationSummary, pinned: boolean) =>
    replaceConversationSummary(queryClient, {
      ...(findCachedConversation(queryClient, conversation.id) ?? conversation),
      pinned,
    });

  return async (conversation: ConversationSummary, pinned: boolean) => {
    setPinned(conversation, pinned);
    try {
      await setConversationPinned(conversation.id, pinned);
    } catch {
      setPinned(conversation, !pinned);
      toast.error(
        pinned ? "채팅을 고정하지 못했습니다." : "채팅 고정을 풀지 못했습니다.",
      );
      return;
    }
    await refreshConversationInList(queryClient, conversation.id, {
      attachmentsChanged: false,
    }).catch(() => invalidateConversationList(queryClient));
  };
}
