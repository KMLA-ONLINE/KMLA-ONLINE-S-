import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import {
  invalidateConversationList,
  removeConversationFromList,
} from "~/features/messaging/data/cache";
import { setConversationHidden } from "~/features/messaging/data/mutations";

/**
 * 대화를 내 목록에서 숨긴다(기능 명세 §13.23). 읽지 않은 수는 그대로 두고, 탭 배지에서만 빠진다. 넓은
 * 화면에서 보고 있던 대화를 숨기면 목록에 없는 대화방이 남지 않게 대화 목록으로 돌아간다.
 */
export function useHideConversation(selectedRoomId: string | undefined) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return async (conversationId: string) => {
    try {
      await setConversationHidden(conversationId, true);
    } catch {
      toast.error("채팅을 숨기지 못했습니다.");
      return;
    }
    removeConversationFromList(queryClient, conversationId);
    void invalidateConversationList(queryClient);
    if (conversationId === selectedRoomId) {
      await navigate("/messenger", { replace: true });
    }
  };
}
