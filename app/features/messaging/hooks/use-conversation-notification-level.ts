import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  conversationListQuery,
  invalidateConversationList,
} from "~/features/messaging/data/cache";
import { setConversationNotificationLevel } from "~/features/messaging/data/mutations";
import { refreshConversationInList } from "~/features/messaging/data/sync";
import type {
  Conversation,
  ConversationNotificationLevel,
} from "~/features/messaging/model/types";

const FAILURE_MESSAGE: Record<ConversationNotificationLevel, string> = {
  all: "채팅 알림을 켜지 못했습니다.",
  mentions: "멘션 알림으로 바꾸지 못했습니다.",
  off: "채팅 알림을 끄지 못했습니다.",
};

/**
 * 대화 알림 단계(기능 명세 §13.17). 상태의 정본은 대화 목록이다. 다른 기기에서 바꾼 값도 목록이 다시
 * 읽히면 따라간다. 내 요청이 진행 중일 때만 그 값을 먼저 그리고, 실패하면 목록 값으로 돌아간다.
 * 연달아 바꾸면 마지막 요청만 결과를 반영한다.
 */
export function useConversationNotificationLevel(conversation: Conversation) {
  const queryClient = useQueryClient();
  const { data: conversations } = useQuery(conversationListQuery());
  const listed = conversations?.find(({ id }) => id === conversation.id);
  const [requested, setRequested] =
    useState<ConversationNotificationLevel | null>(null);
  const latestRequest = useRef(0);
  const level =
    requested ?? listed?.notificationLevel ?? conversation.notificationLevel;

  const change = async (next: ConversationNotificationLevel) => {
    const request = ++latestRequest.current;
    setRequested(next);
    try {
      await setConversationNotificationLevel(conversation.id, next);
      await refreshConversationInList(queryClient, conversation.id, {
        attachmentsChanged: false,
      }).catch(() => invalidateConversationList(queryClient));
    } catch {
      if (request === latestRequest.current) {
        toast.error(FAILURE_MESSAGE[next]);
      }
    } finally {
      if (request === latestRequest.current) setRequested(null);
    }
  };

  return {
    notificationLevel: level,
    setNotificationLevel: (next: ConversationNotificationLevel) =>
      void change(next),
  };
}
