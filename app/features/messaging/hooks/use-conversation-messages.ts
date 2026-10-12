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
  holdMessageWrite,
  initialMessagePages,
  invalidateConversationList,
  markConversationListRead,
  messagingKeys,
  patchMessage,
  patchReplyPreviews,
  REPLY_PREVIEW_LENGTH,
  removeMessage,
} from "~/features/messaging/data/cache";
import {
  deleteMessages,
  editMessage,
  markConversationRead,
  sendMessage,
  setMessagePinned,
  setMessageReaction,
} from "~/features/messaging/data/mutations";
import {
  listMessages,
  listPinnedMessages,
} from "~/features/messaging/data/queries";
import { refreshConversationInList } from "~/features/messaging/data/sync";
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

type RequestField = "reaction" | "pin" | "content";

export interface SendDraft {
  /** 호출하는 쪽이 정해 두면, 이 메시지가 화면에 나타나는 순간을 그 ID로 기다릴 수 있다. */
  id?: string;
  body: string;
  replyTo?: MessageReplyPreview;
}

/**
 * 대화방 메시지와 고정 메시지 cache. 둘 다 대화방 loader가 `seedConversationCache`로 채우고,
 * 위로 스크롤하면 앞선 페이지를 붙인다. 신선도는 시간이 아니라 Realtime 신호와 따라잡기가 맡으므로(기술 설계 §5,
 * `MessagingSync`) 시간 경과로 다시 읽지 않는다.
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
  /** 실패한 전송의 ID. 같은 내용을 다시 보내면 같은 ID를 써서 서버가 한 번만 저장하게 한다. */
  const failedSends = useRef(new Map<string, string>());

  // 대화 목록에서 이 대화 한 줄만 다시 받는다. 실패하면 목록 전체를 다시 읽는다.
  const refreshList = () => {
    refreshConversationInList(queryClient, conversationId).catch(
      () => void invalidateConversationList(queryClient),
    );
  };

  // 화면에 나온 가장 최근 상대 메시지까지 읽은 것으로 기록한다. 마지막 메시지가 아니라 마지막 "상대"
  // 메시지를 본다. 내 메시지가 뒤에 있어도 그 앞의 상대 메시지는 읽은 것이고, 서버는 읽음 위치를
  // 앞으로만 옮기므로 이미 지난 메시지면 아무 일도 없다. 이 위치가 메시지 Push 억제의 근거이므로
  // 탭이 실제로 보일 때만 기록하고, 가려진 탭이면 다시 보일 때 기록한다. 실패하면 사용자에게 알리지
  // 않고 다음에 보일 때 다시 시도한다.
  const unreadLatestId = latestIncomingMessageId(
    messages,
    conversation.viewerId,
  );
  useEffect(() => {
    if (!unreadLatestId) return;
    let pending = true;
    const mark = () => {
      if (!pending || document.visibilityState !== "visible") return;
      pending = false;
      // 가장 최근 상대 메시지까지 읽었으니 이 대화의 읽지 않은 수는 0이다. 목록을 먼저 그린다.
      markConversationListRead(queryClient, conversationId);
      markConversationRead(conversationId, unreadLatestId).then(
        () => {
          refreshConversationInList(queryClient, conversationId).catch(
            () => void invalidateConversationList(queryClient),
          );
        },
        () => {
          pending = true;
        },
      );
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [conversationId, unreadLatestId, queryClient]);

  /**
   * 이 메시지의 한 필드 묶음에 대한 새 요청 번호. 응답이 왔을 때 아직 마지막 요청인지 비교한다.
   * 반응, 고정, 본문은 서로 다른 필드를 바꾸므로 번호를 따로 센다. 하나로 세면 그 사이에 낀
   * 반응 때문에 실패한 수정이 되돌아가지 않는다.
   */
  function beginRequest(messageId: string, field: RequestField) {
    const key = `${messageId}:${field}`;
    const request = (latestRequest.current.get(key) ?? 0) + 1;
    latestRequest.current.set(key, request);
    return () => latestRequest.current.get(key) === request;
  }

  function current(message: ConversationMessage) {
    return (
      findCachedMessage(queryClient, conversationId, message.id) ?? message
    );
  }

  const sendKey = (body: string, replyToId: string | undefined) =>
    `${replyToId ?? ""}\n${body}`;

  /**
   * 보낼 메시지의 ID. 응답을 잃어 실패로 보인 전송을 같은 내용으로 다시 보내면 그때의 ID를 돌려준다.
   * 서버가 이미 저장했으면 같은 ID라 다시 저장하지 않는다.
   */
  const draftIdFor = (body: string, replyToId?: string) =>
    failedSends.current.get(sendKey(body, replyToId)) ?? crypto.randomUUID();

  const send = async ({ id, body, replyTo }: SendDraft) => {
    const key = sendKey(body, replyTo?.id);
    const draft: ConversationMessage = {
      id: id ?? failedSends.current.get(key) ?? crypto.randomUUID(),
      senderId: conversation.viewerId,
      body,
      sentAt: new Date().toISOString(),
      replyTo,
      unreadMemberCount: conversation.participants.length - 1,
      pending: true,
    };
    appendMessage(queryClient, conversationId, draft);
    const release = holdMessageWrite(draft.id);
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
      failedSends.current.delete(key);
      patchMessage(queryClient, conversationId, draft.id, {
        ...sent,
        pending: false,
      });
      refreshList();
      return true;
    } catch {
      failedSends.current.set(key, draft.id);
      // 그새 따라잡기가 서버 행을 넣었으면(응답만 잃은 경우) 거두지 않는다.
      if (findCachedMessage(queryClient, conversationId, draft.id)?.pending) {
        removeMessage(queryClient, conversationId, draft.id);
      }
      toast.error("메시지를 보내지 못했습니다.");
      return false;
    } finally {
      release();
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
    const isLatest = beginRequest(message.id, "reaction");
    const release = holdMessageWrite(message.id);
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
    } finally {
      release();
    }
  };

  const togglePinned = async (target: ConversationMessage) => {
    const message = current(target);
    const pinned = !message.pinned;
    const isLatest = beginRequest(message.id, "pin");
    const release = holdMessageWrite(message.id);
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
    } finally {
      release();
    }
  };

  /** 내 메시지를 고친다. 실패하면 되돌리고 false로 끝난다. 고치던 입력은 화면이 되살린다. */
  const edit = async (target: ConversationMessage, body: string) => {
    const message = current(target);
    const previous = { body: message.body, editedAt: message.editedAt };
    const isLatest = beginRequest(message.id, "content");
    const apply = (patch: Pick<ConversationMessage, "body" | "editedAt">) => {
      patchMessage(queryClient, conversationId, message.id, patch);
      patchReplyPreviews(queryClient, conversationId, message.id, {
        body: patch.body.slice(0, REPLY_PREVIEW_LENGTH),
      });
    };
    apply({ body, editedAt: new Date().toISOString() });
    const release = holdMessageWrite(message.id);
    try {
      const saved = await editMessage(message.id, body);
      if (isLatest()) apply(saved);
      refreshList();
      return true;
    } catch {
      if (isLatest()) apply(previous);
      toast.error("메시지를 고치지 못했습니다.");
      return false;
    } finally {
      release();
    }
  };

  /** 내 메시지를 지운다. 자리는 남기고 본문, 반응, 고정을 거두며 이 메시지를 인용한 답장도 고친다. */
  const remove = async (target: ConversationMessage) => {
    const message = current(target);
    const previous = {
      body: message.body,
      deleted: message.deleted,
      reactions: message.reactions,
      myReaction: message.myReaction,
      pinned: message.pinned,
    };
    const isLatest = beginRequest(message.id, "content");
    // 진행 중인 반응·고정의 응답이나 되돌림이 지운 메시지에 다시 붙지 않게 한다.
    beginRequest(message.id, "reaction");
    beginRequest(message.id, "pin");
    patchMessage(queryClient, conversationId, message.id, {
      body: "",
      deleted: true,
      reactions: [],
      myReaction: null,
      pinned: false,
    });
    patchReplyPreviews(queryClient, conversationId, message.id, {
      body: "",
      deleted: true,
    });
    const release = holdMessageWrite(message.id);
    try {
      await deleteMessages([message.id]);
      refreshList();
    } catch {
      if (!isLatest()) return;
      patchMessage(queryClient, conversationId, message.id, previous);
      patchReplyPreviews(queryClient, conversationId, message.id, {
        body: message.body.slice(0, REPLY_PREVIEW_LENGTH),
        deleted: message.deleted,
      });
      toast.error("메시지를 삭제하지 못했습니다.");
    } finally {
      release();
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
    draftIdFor,
    react: (message: ConversationMessage, reaction: PostReaction) =>
      void react(message, reaction),
    togglePinned: (message: ConversationMessage) => void togglePinned(message),
    edit,
    remove: (message: ConversationMessage) => void remove(message),
  };
}

/** 가장 최근의 상대 메시지. 아직 서버가 확정하지 않은 메시지와 시스템 메시지는 건너뛴다. */
function latestIncomingMessageId(
  messages: ConversationMessage[],
  viewerId: string,
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message &&
      message.senderId !== viewerId &&
      !message.pending &&
      !message.system
    ) {
      return message.id;
    }
  }
  return undefined;
}
