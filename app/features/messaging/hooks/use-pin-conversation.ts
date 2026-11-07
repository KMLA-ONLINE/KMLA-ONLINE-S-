import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  findCachedConversation,
  invalidateConversationList,
  replaceConversationSummary,
} from "~/features/messaging/data/cache";
import { setConversationPinned } from "~/features/messaging/data/mutations";
import type { ConversationSummary } from "~/features/messaging/model/types";

/**
 * 대화를 내 목록 맨 위에 고정하거나 푼다(기능 명세 §13.2). 목록을 먼저 다시 정렬해 그리고, 서버가
 * 거부하면 되돌린다. 정본은 뒤이어 다시 읽는 목록이다.
 */
export function usePinConversation() {
  const queryClient = useQueryClient();

  return async (conversation: ConversationSummary, pinned: boolean) => {
    const previous = findCachedConversation(queryClient, conversation.id);
    replaceConversationSummary(queryClient, { ...conversation, pinned });
    try {
      await setConversationPinned(conversation.id, pinned);
    } catch {
      if (previous) replaceConversationSummary(queryClient, previous);
      toast.error(
        pinned ? "채팅을 고정하지 못했습니다." : "채팅 고정을 풀지 못했습니다.",
      );
      return;
    }
    void invalidateConversationList(queryClient);
  };
}
