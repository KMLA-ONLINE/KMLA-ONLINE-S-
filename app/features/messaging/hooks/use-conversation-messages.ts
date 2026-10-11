import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";

import {
  appendMessage,
  flattenMessagePages,
  messagingKeys,
  patchMessage,
  removeMessage,
  type MessagePages,
} from "~/features/messaging/data/cache";
import {
  sendMessage,
  setMessagePinned,
  setMessageReaction,
} from "~/features/messaging/data/mutations";
import { listMessages } from "~/features/messaging/data/queries";
import { applyMessageReaction } from "~/features/messaging/model/message-reactions";
import type {
  Conversation,
  ConversationMessage,
  MessageCursor,
} from "~/features/messaging/model/types";
import type { PostReaction } from "~/features/posts/model/types";

/**
 * 대화방 메시지 cache. 첫 페이지는 대화방을 열 때 받은 값으로 채우고, 위로 스크롤하면 앞선
 * 페이지를 붙인다. 신선도는 시간이 아니라 Realtime과 따라잡기가 맡을 것이므로(기술 설계 §5)
 * 시간 경과로 다시 읽지 않는다. 내 변경은 먼저 그리고 정본으로 덮으며, 실패하면 되돌린다.
 */
export function useConversationMessages(conversation: Conversation) {
  const queryClient = useQueryClient();
  const conversationId = conversation.id;
  const initialData: MessagePages = {
    pages: [
      {
        messages: conversation.messages,
        olderCursor: conversation.olderCursor,
      },
    ],
    pageParams: [null],
  };
  const query = useInfiniteQuery({
    queryKey: messagingKeys.messages(conversationId),
    queryFn: ({ pageParam }) => listMessages(conversationId, pageParam),
    initialPageParam: null as MessageCursor | null,
    getNextPageParam: (page) => page.olderCursor,
    initialData,
    staleTime: Infinity,
  });
  const messages = useMemo(() => flattenMessagePages(query.data), [query.data]);

  const send = async (body: string, replyToMessageId?: string) => {
    const draft: ConversationMessage = {
      id: crypto.randomUUID(),
      senderId: conversation.viewerId,
      body,
      sentAt: new Date().toISOString(),
      replyToMessageId,
      unreadMemberCount: conversation.participants.length - 1,
    };
    appendMessage(queryClient, conversationId, draft);
    try {
      const sent = await sendMessage(
        { conversationId, id: draft.id, body, replyToMessageId },
        draft,
      );
      patchMessage(queryClient, conversationId, draft.id, sent);
      return true;
    } catch {
      removeMessage(queryClient, conversationId, draft.id);
      toast.error("메시지를 보내지 못했습니다.");
      return false;
    }
  };

  /** 같은 반응을 다시 고르면 지운다. */
  const react = async (
    message: ConversationMessage,
    reaction: PostReaction,
  ) => {
    const next = message.myReaction === reaction ? null : reaction;
    const previous = {
      reactions: message.reactions,
      myReaction: message.myReaction,
    };
    patchMessage(
      queryClient,
      conversationId,
      message.id,
      applyMessageReaction(message, next),
    );
    try {
      patchMessage(
        queryClient,
        conversationId,
        message.id,
        await setMessageReaction(message, next),
      );
    } catch {
      patchMessage(queryClient, conversationId, message.id, previous);
      toast.error("반응을 남기지 못했습니다.");
    }
  };

  const togglePinned = async (message: ConversationMessage) => {
    const pinned = !message.pinned;
    patchMessage(queryClient, conversationId, message.id, { pinned });
    try {
      patchMessage(
        queryClient,
        conversationId,
        message.id,
        await setMessagePinned(message.id, pinned),
      );
    } catch {
      patchMessage(queryClient, conversationId, message.id, {
        pinned: message.pinned,
      });
      toast.error(
        pinned ? "고정하지 못했습니다." : "고정을 해제하지 못했습니다.",
      );
    }
  };

  return {
    messages,
    hasOlderMessages: query.hasNextPage,
    loadingOlderMessages: query.isFetchingNextPage,
    loadOlderMessages: () => void query.fetchNextPage(),
    send,
    react: (message: ConversationMessage, reaction: PostReaction) =>
      void react(message, reaction),
    togglePinned: (message: ConversationMessage) => void togglePinned(message),
  };
}
