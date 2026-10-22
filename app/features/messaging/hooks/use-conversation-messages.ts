import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { randomUUID } from "~/shared/lib/random-uuid";
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
import { closeMessageNotifications } from "~/features/messaging/data/push-cards";
import { refreshConversationInList } from "~/features/messaging/data/sync";
import {
  prepareAttachment,
  uploadAttachments,
  type PreparedAttachment,
} from "~/features/messaging/data/files";
import {
  classifyAttachment,
  groupAttachmentsIntoMessages,
  screenAttachments,
} from "~/features/messaging/model/attachments";
import { toReplyPreviewBody } from "~/features/messaging/model/conversation-preview";
import {
  mentionProfileIdsOf,
  mentionPubIdsOf,
} from "~/features/messaging/model/message-mentions";
import { applyMessageReaction } from "~/features/messaging/model/message-reactions";
import { activeParticipants } from "~/features/messaging/model/system-message";
import type {
  Conversation,
  ConversationMessage,
  MessageCursor,
  MessageAttachment,
  MessagePage,
  MessageReplyPreview,
} from "~/features/messaging/model/types";
import type { PostReaction } from "~/features/posts/model/types";

/** 앞선 페이지 읽기 결과. `empty`면 붙인 메시지가 없다. */
export type OlderMessagesResult = "loaded" | "empty" | "failed";

type RequestField = "reaction" | "pin" | "content";

/** 보낸 첨부의 기기 미리보기를 거두기까지의 시간. 그동안 signed URL 이미지가 준비된다. */
const PREVIEW_RELEASE_DELAY_MS = 30_000;

/** 같은 메시지 ID가 이미 저장돼 첨부 예고가 거절됐는지. 앞선 전송이 응답만 잃은 경우다. */
function isAlreadySent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}

/**
 * 1:1 상대가 탈퇴해 서버가 전송을 거부했다. 탈퇴는 실시간 신호를 보내지 않으므로, 열려 있던 대화방은
 * 이 거부로 처음 알게 된다. 대화를 다시 읽으면 입력창이 안내 문구로 바뀐다.
 */
function isRecipientWithdrawn(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { hint?: unknown }).hint === "recipient_withdrawn"
  );
}

/** 메시지로 이동할 때 이어 읽는 페이지 수 상한. 50개씩 100쪽, 메시지 5,000개 전까지 간다. */
const MAX_JUMP_PAGES = 100;

export interface SendDraft {
  /** 호출하는 쪽이 정해 두면, 이 메시지가 화면에 나타나는 순간을 그 ID로 기다릴 수 있다. */
  id?: string;
  body: string;
  replyTo?: MessageReplyPreview;
  /** 본문 `m:n` 토큰이 부르는 사람의 공개 ID. n번 토큰이 `n - 1`번째다. */
  mentionPubIds?: string[];
  mentionsEveryone?: boolean;
}

/**
 * 대화방 메시지와 고정 메시지 cache. 둘 다 대화방 loader(`openConversation`)가 채우고,
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
  /** 첨부 메시지의 원본 파일과 정규화한 결과. 다시 보낼 때 다시 고르지 않게 한다. */
  const attachmentFiles = useRef(new Map<string, File[]>());
  const preparedAttachments = useRef(new Map<string, PreparedAttachment[]>());

  // 대화 목록에서 이 대화 한 줄만 다시 받는다. 실패하면 목록 전체를 다시 읽는다.
  const refreshList = () => {
    refreshConversationInList(queryClient, conversationId).catch(
      () => void invalidateConversationList(queryClient),
    );
  };

  // 화면에 나온 가장 최근 상대 메시지까지 읽은 것으로 기록한다. 마지막 메시지가 아니라 마지막 "상대"
  // 메시지를 본다. 내 메시지가 뒤에 있어도 그 앞의 상대 메시지는 읽은 것이고, 서버는 읽음 위치를
  // 앞으로만 옮기므로 이미 지난 메시지면 아무 일도 없다. 이 위치가 계정의 모든 기기에서 메시지 Push를
  // 억제하는 근거이므로 창이 보이고 포커스도 있을 때만 기록한다. 보이기만 하면 다른 창 뒤나 보조
  // 모니터에 열어 둔 PC가 메시지를 읽은 것으로 만들어 폰의 알림까지 막는다. 그렇지 않으면 다시 보이거나
  // 포커스를 얻을 때 기록한다. 실패하면 사용자에게 알리지 않고 다음에 다시 시도한다.
  const unreadLatestId = latestIncomingMessageId(
    messages,
    conversation.viewerId,
  );
  useEffect(() => {
    if (!unreadLatestId) return;
    let pending = true;
    const mark = () => {
      if (
        !pending ||
        document.visibilityState !== "visible" ||
        !document.hasFocus()
      ) {
        return;
      }
      pending = false;
      // 가장 최근 상대 메시지까지 읽었으니 이 대화의 읽지 않은 수는 0이다. 목록을 먼저 그린다.
      const cleared = markConversationListRead(queryClient, conversationId);
      // 읽은 대화의 알림 카드는 알림센터에서도 거둔다.
      void closeMessageNotifications(conversationId);
      markConversationRead(conversationId, unreadLatestId).then(
        (moved) => {
          // 이미 읽은 방이고 목록도 읽음이었으면 서버도 목록도 그대로라 다시 읽지 않는다. 서버가 옮기지
          // 않았어도 목록에서 뺀 수가 있으면 목록이 낡았던 것이므로 다시 읽는다.
          if (!moved && cleared === 0) return;
          refreshConversationInList(queryClient, conversationId, {
            attachmentsChanged: false,
          }).catch(() => void invalidateConversationList(queryClient));
        },
        () => {
          pending = true;
        },
      );
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    window.addEventListener("focus", mark);
    return () => {
      document.removeEventListener("visibilitychange", mark);
      window.removeEventListener("focus", mark);
    };
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

  /**
   * 초안을 서버에 보낸다. 실패하면 목록에 "보내지 못함"으로 남긴다. 같은 ID로 다시 보내므로 응답만
   * 잃은 전송이었어도 서버는 한 번만 저장한다. 그새 따라잡기가 서버 행을 넣었으면 실패로 바꾸지 않는다.
   */
  const deliver = async (draft: ConversationMessage) => {
    const release = holdMessageWrite(draft.id);
    try {
      const sent = await sendMessage(
        {
          conversationId,
          id: draft.id,
          body: draft.body,
          replyToMessageId: draft.replyTo?.id,
          // 다시 보낼 때도 같은 대상을 보내도록 화면에 그린 참여자 ID에서 되찾는다.
          mentionPubIds: mentionPubIdsOf(
            draft.mentionProfileIds ?? [],
            conversation.participants,
          ),
        },
        draft,
      );
      patchMessage(queryClient, conversationId, draft.id, {
        ...sent,
        pending: false,
        failed: false,
      });
      refreshList();
      return true;
    } catch (error) {
      if (findCachedMessage(queryClient, conversationId, draft.id)?.pending) {
        patchMessage(queryClient, conversationId, draft.id, {
          pending: false,
          failed: true,
        });
      }
      if (isRecipientWithdrawn(error)) refreshList();
      // 실패는 말풍선의 "보내지 못했습니다"로 알린다. 토스트까지 띄우면 모바일에서 그 표시를 가린다.
      return false;
    } finally {
      release();
    }
  };

  const send = async ({
    id,
    body,
    replyTo,
    mentionPubIds = [],
    mentionsEveryone = false,
  }: SendDraft) => {
    const draft: ConversationMessage = {
      id: id ?? randomUUID(),
      senderId: conversation.viewerId,
      body,
      sentAt: new Date().toISOString(),
      replyTo,
      mentionProfileIds: mentionProfileIdsOf(
        mentionPubIds,
        conversation.participants,
      ),
      mentionsEveryone,
      unreadMemberCount: activeParticipants(conversation).length - 1,
      pending: true,
    };
    appendMessage(queryClient, conversationId, draft);
    return deliver(draft);
  };

  /**
   * 첨부를 정규화하고 올린 뒤 같은 ID로 메시지를 보낸다. 정규화한 결과는 다시 보내기에 쓰도록
   * 기억한다. 실패하면 목록에 "보내지 못함"으로 남긴다.
   */
  const deliverAttachments = async (draft: ConversationMessage) => {
    const release = holdMessageWrite(draft.id);
    let shown = draft.attachments ?? [];
    try {
      let prepared = preparedAttachments.current.get(draft.id);
      if (!prepared) {
        ({ prepared, shown } = await prepareKeepingSuccesses(draft.id, shown));
      }
      preparedAttachments.current.set(draft.id, prepared);
      // 앞선 시도가 사실은 전송까지 마쳤고 응답만 잃었으면 서버가 "이미 보낸 메시지"로 예고를 거절한다.
      // 그때는 다시 올리지 않고 같은 ID의 전송으로 서버 행을 받는다. 첨부는 따라잡기가 정본으로 덮는다.
      let attachments: MessageAttachment[] | null = null;
      try {
        attachments = await uploadAttachments(
          conversationId,
          draft.id,
          prepared,
        );
      } catch (error) {
        if (!isAlreadySent(error)) throw error;
      }
      const sent = await sendMessage(
        { conversationId, id: draft.id, body: draft.body },
        draft,
      );
      preparedAttachments.current.delete(draft.id);
      attachmentFiles.current.delete(draft.id);
      patchMessage(queryClient, conversationId, draft.id, {
        ...sent,
        // 올라간 사진이 signed URL로 다시 그려지는 동안 깜박이지 않게 기기 미리보기를 잠시 이어 쓴다.
        attachments: (attachments ?? shown).map((attachment, index) => ({
          ...attachment,
          previewUrl: shown[index]?.previewUrl,
        })),
        pending: false,
        failed: false,
      });
      releasePreviews(draft.id);
      refreshList();
      return true;
    } catch (error) {
      if (findCachedMessage(queryClient, conversationId, draft.id)?.pending) {
        patchMessage(queryClient, conversationId, draft.id, {
          pending: false,
          failed: true,
        });
      }
      if (isRecipientWithdrawn(error)) refreshList();
      // 실패는 말풍선이 알린다. 크기 제한처럼 사용자가 고칠 수 있는 사유만 토스트로 덧붙인다.
      if (error instanceof Error && error.message.includes("MB")) {
        toast.error(error.message);
      }
      return false;
    } finally {
      release();
    }
  };

  /**
   * 고른 파일을 업로드할 수 있게 만든다. 사진 묶음에서 일부만 변환에 실패하면(브라우저가 열지 못하는
   * 형식 등) 그 사진만 빼고 알린 뒤 나머지를 보낸다. 다시 보내도 같은 이유로 실패하므로 묶음 전체를
   * 실패로 남기지 않는다. 모두 실패하면 첫 오류를 던져 메시지를 "보내지 못함"으로 남긴다.
   */
  const prepareKeepingSuccesses = async (
    messageId: string,
    shown: MessageAttachment[],
  ) => {
    const files = attachmentFiles.current.get(messageId) ?? [];
    const settled = await Promise.allSettled(files.map(prepareAttachment));
    const failed = settled.flatMap((result, index) =>
      result.status === "rejected" ? [index] : [],
    );
    const firstFailure = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (firstFailure && failed.length === settled.length) {
      throw firstFailure.reason;
    }
    const prepared = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    if (failed.length === 0) return { prepared, shown };

    const keep = (_: unknown, index: number) => !failed.includes(index);
    const kept = shown.filter(keep);
    for (const index of failed) {
      const previewUrl = shown[index]?.previewUrl;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    }
    attachmentFiles.current.set(messageId, files.filter(keep));
    patchMessage(queryClient, conversationId, messageId, { attachments: kept });
    const [onlyFailed] = failed;
    toast.error(
      failed.length === 1 && onlyFailed !== undefined
        ? `사진 한 장은 보내지 못했습니다: ${files[onlyFailed]?.name ?? ""}`
        : `사진 ${failed.length}장은 보내지 못했습니다.`,
    );
    return { prepared, shown: kept };
  };

  /**
   * 보낸 첨부의 기기 미리보기를 거둔다. 사진 Blob을 붙잡고 있으면 보낸 만큼 메모리가 쌓인다.
   * signed URL로 바꿔 그릴 시간을 주고 잠시 뒤에 미리보기를 떼고 해제한다.
   */
  const releasePreviews = (messageId: string) => {
    setTimeout(() => {
      const message = findCachedMessage(queryClient, conversationId, messageId);
      const previews = (message?.attachments ?? [])
        .map(({ previewUrl }) => previewUrl)
        .filter((url): url is string => Boolean(url));
      if (previews.length === 0) return;
      patchMessage(queryClient, conversationId, messageId, {
        attachments: message?.attachments?.map(
          ({ previewUrl: _preview, ...attachment }) => attachment,
        ),
      });
      for (const url of previews) URL.revokeObjectURL(url);
    }, PREVIEW_RELEASE_DELAY_MS);
  };

  /**
   * 고른 파일을 보낸다. 사진은 30장까지 한 묶음, 일반 파일과 오디오는 10개까지 파일마다 메시지
   * 하나다(기능 명세 §13.5). 동영상과 GIF, 크기 상한을 넘는 것과 넘친 것은 빼고 알린다. 각 메시지는
   * 기기 안의 미리보기로 먼저 그린다.
   */
  const sendFiles = async (selected: File[]) => {
    const { files, notices } = screenAttachments(selected);
    for (const notice of notices) toast.error(notice);
    let allSent = files.length === selected.length;
    for (const group of groupAttachmentsIntoMessages(files)) {
      const id = randomUUID();
      const draft: ConversationMessage = {
        id,
        senderId: conversation.viewerId,
        body: "",
        sentAt: new Date().toISOString(),
        unreadMemberCount: activeParticipants(conversation).length - 1,
        pending: true,
        attachments: group.map((file, index) => {
          const kind = classifyAttachment(file);
          return {
            id: `${id}:${index}`,
            kind,
            mimeType: file.type,
            sizeBytes: file.size,
            width: null,
            height: null,
            fileName: file.name,
            objectPath: "",
            thumbnailPath: null,
            previewUrl:
              kind === "image" ? URL.createObjectURL(file) : undefined,
          };
        }),
      };
      attachmentFiles.current.set(id, group);
      appendMessage(queryClient, conversationId, draft);
      if (!(await deliverAttachments(draft))) allSent = false;
    }
    return allSent;
  };

  /** 보내지 못한 메시지를 같은 ID로 다시 보낸다. 맨 아래로 다시 붙인다. */
  const retry = (target: ConversationMessage) => {
    const message = current(target);
    if (!message.failed) return;
    const draft = {
      ...message,
      sentAt: new Date().toISOString(),
      pending: true,
      failed: false,
    };
    patchMessage(queryClient, conversationId, message.id, draft);
    void (message.attachments?.length
      ? deliverAttachments(draft)
      : deliver(draft));
  };

  /** 보내지 못한 메시지를 목록에서 거둔다. 서버에는 없다. */
  const discard = (target: ConversationMessage) => {
    const message = current(target);
    if (!message.failed) return;
    for (const attachment of message.attachments ?? []) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    }
    attachmentFiles.current.delete(message.id);
    preparedAttachments.current.delete(message.id);
    removeMessage(queryClient, conversationId, target.id);
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

  /**
   * 이 메시지가 불러온 페이지에 들 때까지 앞선 페이지를 이어 읽는다. 검색 결과나 답장 인용, 고정 메시지가
   * 아직 불러오지 않은 구간에 있을 때 쓴다. 찾으면 true, 대화의 처음에 닿거나 읽기가 실패하면 false다.
   */
  const loadUntil = async (messageId: string) => {
    const found = (data: { pages: MessagePage[] } | undefined) =>
      Boolean(
        data && flattenMessagePages(data).some(({ id }) => id === messageId),
      );
    if (
      found(queryClient.getQueryData(messagingKeys.messages(conversationId)))
    ) {
      return true;
    }
    for (let page = 0; page < MAX_JUMP_PAGES; page += 1) {
      const result = await pagesQuery.fetchNextPage();
      if (result.isFetchNextPageError) return false;
      if (found(result.data)) return true;
      if (!result.hasNextPage) return false;
    }
    return false;
  };

  /** 내 메시지를 고친다. 실패하면 되돌리고 false로 끝난다. 고치던 입력은 화면이 되살린다. */
  const edit = async (
    target: ConversationMessage,
    body: string,
    mentionPubIds: string[] = [],
    mentionsEveryone = false,
  ) => {
    const message = current(target);
    const previous = {
      body: message.body,
      editedAt: message.editedAt,
      mentionProfileIds: message.mentionProfileIds,
      mentionsEveryone: message.mentionsEveryone,
    };
    const isLatest = beginRequest(message.id, "content");
    const apply = (
      patch: Pick<
        ConversationMessage,
        "body" | "editedAt" | "mentionProfileIds" | "mentionsEveryone"
      >,
    ) => {
      patchMessage(queryClient, conversationId, message.id, patch);
      patchReplyPreviews(queryClient, conversationId, message.id, {
        body: toReplyPreviewBody(patch.body),
      });
    };
    const mentionProfileIds = mentionProfileIdsOf(
      mentionPubIds,
      conversation.participants,
    );
    apply({
      body,
      editedAt: new Date().toISOString(),
      mentionProfileIds,
      mentionsEveryone,
    });
    const release = holdMessageWrite(message.id);
    try {
      const saved = await editMessage(message.id, body, mentionPubIds);
      if (isLatest()) apply({ ...saved, mentionProfileIds, mentionsEveryone });
      refreshList();
      return true;
    } catch {
      if (isLatest()) apply(previous);
      toast.error("메시지를 수정하지 못했습니다.");
      return false;
    } finally {
      release();
    }
  };

  /**
   * 내 메시지들을 지운다(삭제 모드는 여러 개를 한 번에). 자리는 남기고 본문, 반응, 고정을 거두며 이
   * 메시지들을 인용한 답장도 고친다. 서버는 하나라도 내 메시지가 아니면 아무것도 지우지 않으므로
   * 실패하면 모두 되돌린다.
   */
  const removeMany = async (targets: ConversationMessage[]) => {
    const messages = targets.map(current).filter((message) => !message.deleted);
    if (messages.length === 0) return;
    const undo = messages.map((message) => {
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
      return {
        release,
        rollback: () => {
          if (!isLatest()) return;
          patchMessage(queryClient, conversationId, message.id, previous);
          patchReplyPreviews(queryClient, conversationId, message.id, {
            body: toReplyPreviewBody(message.body),
            deleted: message.deleted,
          });
        },
      };
    });
    try {
      await deleteMessages(messages.map(({ id }) => id));
      refreshList();
    } catch {
      for (const { rollback } of undo) rollback();
      toast.error("메시지를 삭제하지 못했습니다.");
    } finally {
      for (const { release } of undo) release();
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
    sendFiles,
    retry,
    discard,
    loadUntil,
    react: (message: ConversationMessage, reaction: PostReaction) =>
      void react(message, reaction),
    togglePinned: (message: ConversationMessage) => void togglePinned(message),
    edit,
    remove: (message: ConversationMessage) => void removeMany([message]),
    removeMany: (messages: ConversationMessage[]) => void removeMany(messages),
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
