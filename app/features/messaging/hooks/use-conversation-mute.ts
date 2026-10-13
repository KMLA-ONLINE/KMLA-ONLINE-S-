import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  conversationListQuery,
  invalidateConversationList,
} from "~/features/messaging/data/cache";
import { setConversationMuted } from "~/features/messaging/data/mutations";
import { refreshConversationInList } from "~/features/messaging/data/sync";
import type { Conversation } from "~/features/messaging/model/types";

/**
 * 대화 알림 끄기(기능 명세 §13.17). 상태의 정본은 대화 목록이다. 다른 기기에서 바꾼 값도 목록이 다시
 * 읽히면 따라간다. 내 요청이 진행 중일 때만 그 값을 먼저 그리고, 실패하면 목록 값으로 돌아간다.
 * 연달아 누르면 마지막 요청만 결과를 반영한다.
 */
export function useConversationMute(conversation: Conversation) {
  const queryClient = useQueryClient();
  const { data: conversations } = useQuery(conversationListQuery());
  const listed = conversations?.find(({ id }) => id === conversation.id);
  const [requested, setRequested] = useState<boolean | null>(null);
  const latestRequest = useRef(0);
  const muted = requested ?? listed?.muted ?? conversation.muted;

  const toggle = async () => {
    const next = !muted;
    const request = ++latestRequest.current;
    setRequested(next);
    try {
      await setConversationMuted(conversation.id, next);
      await refreshConversationInList(queryClient, conversation.id).catch(() =>
        invalidateConversationList(queryClient),
      );
    } catch {
      if (request === latestRequest.current) {
        toast.error(
          next
            ? "대화 알림을 끄지 못했습니다."
            : "대화 알림을 켜지 못했습니다.",
        );
      }
    } finally {
      if (request === latestRequest.current) setRequested(null);
    }
  };

  return { muted, toggleMuted: () => void toggle() };
}
