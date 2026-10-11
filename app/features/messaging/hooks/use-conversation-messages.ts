import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import {
  appendMessage,
  findCachedMessage,
  flattenMessagePages,
  initialMessagePages,
  invalidateConversationList,
  messagingKeys,
  patchMessage,
  removeMessage,
} from "~/features/messaging/data/cache";
import {
  markConversationRead,
  sendMessage,
  setMessagePinned,
  setMessageReaction,
} from "~/features/messaging/data/mutations";
import {
  listMessages,
  listPinnedMessages,
} from "~/features/messaging/data/queries";
import { applyMessageReaction } from "~/features/messaging/model/message-reactions";
import type {
  Conversation,
  ConversationMessage,
  MessageCursor,
  MessageReplyPreview,
} from "~/features/messaging/model/types";
import type { PostReaction } from "~/features/posts/model/types";

/** 앞선 페이지 읽기 결과. `empty`면 붙인 메시지가 없다. */
export type OlderMessagesResult = "loaded" | "empty" | "failed";

export interface SendDraft {
  /** 호출하는 쪽이 정해 두면, 이 메시지가 화면에 나타나는 순간을 그 ID로 기다릴 수 있다. */
  id?: string;
  body: string;
  replyTo?: MessageReplyPreview;
}

/**
 * 대화방 메시지와 고정 메시지 cache. 둘 다 대화방 loader가 `seedConversationCache`로 채우고,
 * 위로 스크롤하면 앞선 페이지를 붙인다. 신선도는 시간이 아니라 Realtime과 따라잡기가 맡을
 * 것이므로(기술 설계 §5) 시간 경과로 다시 읽지 않는다.
 *
 * 내 변경은 먼저 그리고 정본으로 덮으며, 실패하면 되돌린다. 같은 메시지에 요청이 겹치면 마지막
 * 요청만 결과를 반영한다. 먼저 보낸 요청의 응답이나 되돌림이 나중 선택을 덮지 않게 하기 위해서다.
 */
export function useConversationMessages(conversation: Conversation) {
  const queryClient = useQueryClient();
  const conversationId = conversation.id;
  // loader가 cache를 이미 채운 경우에는 쓰이지 않는다. cache가 비었을 때(테스트 등)의 시작값이다.
  const initialPages = useMemo(
    () => initialMessagePages(conversation),
    [conversation],
  );
  const pagesQuery = useInfiniteQuery({
    queryKey: messagingKeys.messages(conversationId),
    queryFn: ({ pageParam }) => listMessages(conversationId, pageParam),
    initialPageParam: null as MessageCursor | null,
    getNextPageParam: (page) => page.olderCursor,
    initialData: initialPages,
    staleTime: Infinity,
    // 앞선 페이지 읽기가 실패하면 스크롤 위치에서 다시 부르지 않고 화면이 다시 시도를 정한다.
    retry: false,
  });
  const pinnedQuery = useQuery({
    queryKey: messagingKeys.pinned(conversationId),
    queryFn: () => listPinnedMessages(conversationId),
    initialData: conversation.pinnedMessages,
    staleTime: Infinity,
  });
  const messages = useMemo(
    () => flattenMessagePages(pagesQuery.data),
    [pagesQuery.data],
  );
  const latestRequest = useRef(new Map<string, number>());

  // 화면에 나온 가장 최근 상대 메시지까지 읽은 것으로 기록한다. 내 메시지는 보낼 때 서버가 읽음
  // 위치를 옮긴다. 이 위치가 메시지 Push 억제의 근거이므로 탭이 실제로 보일 때만 기록하고, 가려진
  // 탭이면 다시 보일 때 기록한다. 실패하면 사용자에게 알리지 않고 다음에 보일 때 다시 시도한다.
  const latestMessage = messages.at(-1);
  const unreadLatestId =
    latestMessage && latestMessage.senderId !== conversation.viewerId
      ? latestMessage.id
      : undefined;
  useEffect(() => {
    if (!unreadLatestId) return;
    let pending = true;
    const mark = () => {
      if (!pending || document.visibilityState !== "visible") return;
      pending = false;
      markConversationRead(conversationId, unreadLatestId).then(
        () => void invalidateConversationList(queryClient),
        () => {
          pending = true;
        },
      );
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [conversationId, unreadLatestId, queryClient]);

  /** 이 메시지에 대한 새 요청 번호. 응답이 왔을 때 아직 마지막 요청인지 비교한다. */
  function beginRequest(messageId: string) {
    const request = (latestRequest.current.get(messageId) ?? 0) + 1;
    latestRequest.current.set(messageId, request);
    return () => latestRequest.current.get(messageId) === request;
  }

  function current(message: ConversationMessage) {
    return (
      findCachedMessage(queryClient, conversationId, message.id) ?? message
    );
  }

  const send = async ({ id, body, replyTo }: SendDraft) => {
    const draft: ConversationMessage = {
      id: id ?? crypto.randomUUID(),
      senderId: conversation.viewerId,
      body,
      sentAt: new Date().toISOString(),
      replyTo,
      unreadMemberCount: conversation.participants.length - 1,
    };
    appendMessage(queryClient, conversationId, draft);
    try {
      const sent = await sendMessage(
        {
          conversationId,
          id: draft.id,
          body,
          replyToMessageId: replyTo?.id,
        },
        draft,
      );
      patchMessage(queryClient, conversationId, draft.id, sent);
      void invalidateConversationList(queryClient);
      return true;
    } catch {
      removeMessage(queryClient, conversationId, draft.id);
      toast.error("메시지를 보내지 못했습니다.");
      return false;
    }
  };

  /** 같은 반응을 다시 고르면 지운다. */
  const react = async (target: ConversationMessage, reaction: PostReaction) => {
    const message = current(target);
    const next = message.myReaction === reaction ? null : reaction;
    const previous = {
      reactions: message.reactions,
      myReaction: message.myReaction,
    };
    const isLatest = beginRequest(message.id);
    patchMessage(
      queryClient,
      conversationId,
      message.id,
      applyMessageReaction(message, next),
    );
    try {
      const saved = await setMessageReaction(message, next);
      if (isLatest())
        patchMessage(queryClient, conversationId, message.id, saved);
    } catch {
      if (!isLatest()) return;
      patchMessage(queryClient, conversationId, message.id, previous);
      toast.error("반응을 남기지 못했습니다.");
    }
  };

  const togglePinned = async (target: ConversationMessage) => {
    const message = current(target);
    const pinned = !message.pinned;
    const isLatest = beginRequest(message.id);
    patchMessage(queryClient, conversationId, message.id, { pinned });
    try {
      const saved = await setMessagePinned(message.id, pinned);
      if (isLatest())
        patchMessage(queryClient, conversationId, message.id, saved);
    } catch {
      if (!isLatest()) return;
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
    pinnedMessages: pinnedQuery.data,
    hasOlderMessages: pagesQuery.hasNextPage,
    loadingOlderMessages: pagesQuery.isFetchingNextPage,
    loadOlderMessages: async (): Promise<OlderMessagesResult> => {
      const result = await pagesQuery.fetchNextPage();
      if (result.isFetchNextPageError) return "failed";
      return result.data?.pages.at(-1)?.messages.length ? "loaded" : "empty";
    },
    send,
    react: (message: ConversationMessage, reaction: PostReaction) =>
      void react(message, reaction),
    togglePinned: (message: ConversationMessage) => void togglePinned(message),
  };
}
