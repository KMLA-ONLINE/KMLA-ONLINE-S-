import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ImageIcon,
  Maximize2Icon,
  PaperclipIcon,
  SendIcon,
  ThumbsUpIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router";

import { ConversationAvatar } from "~/features/messaging/components/conversation-avatar";
import { MessageParticipantsProvider } from "~/features/messaging/components/message-mention";
import { MessageRow } from "~/features/messaging/components/message-row";
import { TypingIndicator } from "~/features/messaging/components/typing-indicator";
import { messagingKeys } from "~/features/messaging/data/cache";
import { openConversation } from "~/features/messaging/data/sync";
import {
  readRoomDraft,
  roomDraftKey,
  updateRoomDraft,
} from "~/features/messaging/hooks/room-drafts";
import { useListedConversation } from "~/features/messaging/hooks/use-conversation-membership";
import {
  latestIncomingMessageId,
  useConversationMessages,
  type OlderMessagesResult,
} from "~/features/messaging/hooks/use-conversation-messages";
import { useTypingSignals } from "~/features/messaging/hooks/use-typing-signals";
import { layoutMessageThread } from "~/features/messaging/model/message-grouping";
import {
  prepareMessageMentions,
  type PreparedMessageMentions,
} from "~/features/messaging/model/message-mentions";
import { normalizeMessageBody } from "~/features/messaging/model/message-text";
import { formatMessageSessionStart } from "~/features/messaging/model/message-time";
import {
  canSendToConversation,
  directCounterpart,
  formatSystemMessage,
  isDirectCounterpartWithdrawn,
  isViewerActive,
} from "~/features/messaging/model/system-message";
import type {
  Conversation,
  ConversationMessage,
} from "~/features/messaging/model/types";
import type { MentionDraftEntry } from "~/features/posts/model/mentions";
import { isSendEnter } from "~/shared/lib/enter-to-send";
import { MEDIA_INPUT_ACCEPT } from "~/shared/lib/media/motion-policy";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";

/** 맨 아래에서 이만큼 안이면 맨 아래를 보고 있는 것으로 보고, 새 메시지가 오면 따라 내려간다. */
const FOLLOW_NEW_MESSAGES_THRESHOLD = 80;
/** 맨 위까지 이만큼 남으면 앞선 메시지를 미리 읽는다. */
const OLDER_MESSAGES_THRESHOLD = 240;
/** 보낸 뒤 다음 전송까지 쉬는 시간. 대화방과 같은 도배 방지 UI 제한이다. */
const SEND_COOLDOWN_MS = 500;
/** 글을 보낸 뒤 이만큼은 빈 입력의 버튼을 눌러도 좋아요를 보내지 않는다. 버튼을 한 번 더 누른 손을 막는다. */
const LIKE_AFTER_SEND_MS = 1_000;

/**
 * 메시지 독 안에서 열리는 작은 대화방(기능 명세 §13.28). 메시지를 보고 글·좋아요·사진·파일을 보내며 읽음을
 * 기록한다. 답장·반응·검색·대화 정보처럼 URL과 history에 기대는 기능은 `크게 열기`로 대화방 route에 맡긴다.
 *
 * 대화는 대화방 loader와 같은 `openConversation()`으로 열어 메시지 cache를 공유한다. 닫으면 바로 버리고,
 * 다시 열면 남은 cache로 이어 연다.
 */
export function MiniRoom({
  conversationId,
  onBack,
  onClose,
}: {
  conversationId: string;
  /** 대화 목록으로 돌아간다. */
  onBack: () => void;
  /** 메시지 독을 접는다. */
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const room = useQuery({
    queryKey: messagingKeys.dockRoom(conversationId),
    queryFn: () => openConversation(queryClient, conversationId),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  if (room.isPending) {
    return (
      <MiniRoomFrame onBack={onBack} onClose={onClose}>
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </MiniRoomFrame>
    );
  }

  if (room.isError || !room.data) {
    return (
      <MiniRoomFrame onBack={onBack} onClose={onClose}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground">
          <p>
            {room.data === null
              ? "채팅을 찾을 수 없습니다."
              : "채팅을 열지 못했습니다."}
          </p>
          {room.isError ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void room.refetch()}
            >
              다시 시도
            </Button>
          ) : null}
        </div>
      </MiniRoomFrame>
    );
  }

  return (
    <OpenMiniRoom conversation={room.data} onBack={onBack} onClose={onClose} />
  );
}

/** 머리와 본문 자리. 대화가 열리기 전에도 뒤로·닫기는 되게 한다. */
function MiniRoomFrame({
  conversation,
  onBack,
  onClose,
  children,
}: {
  conversation?: Conversation;
  onBack: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-1 border-b pr-2 pl-1">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label="채팅 목록"
          onClick={onBack}
        >
          <ArrowLeftIcon aria-hidden />
        </Button>
        {conversation ? (
          <>
            <ConversationAvatar
              conversation={conversation}
              className="size-8"
            />
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
              {conversation.name}
            </h2>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label="메신저에서 크게 열기"
              render={<Link to={`/messenger/${conversation.id}`} />}
            >
              <Maximize2Icon aria-hidden />
            </Button>
          </>
        ) : (
          <span className="flex-1" />
        )}
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label="메시지 독 닫기"
          onClick={onClose}
        >
          <XIcon aria-hidden />
        </Button>
      </header>
      {children}
    </>
  );
}

function OpenMiniRoom({
  conversation: loadedConversation,
  onBack,
  onClose,
}: {
  conversation: Conversation;
  onBack: () => void;
  onClose: () => void;
}) {
  // 이름과 멤버는 다른 멤버가 바꿀 수 있어 대화 목록의 최신 값을 쓴다.
  const conversation = useListedConversation(loadedConversation);
  const canCompose = canSendToConversation(conversation);
  const {
    messages,
    hasOlderMessages,
    loadingOlderMessages,
    loadOlderMessages,
    send,
    sendFiles,
    retry,
    discard,
  } = useConversationMessages(conversation);
  const typing = useTypingSignals(
    conversation.id,
    conversation.viewerId,
    conversation.type === "direct" && canCompose,
    latestIncomingMessageId(messages, conversation.viewerId),
  );

  return (
    <MiniRoomFrame
      conversation={conversation}
      onBack={onBack}
      onClose={onClose}
    >
      <MessageParticipantsProvider participants={conversation.participants}>
        <MiniThread
          conversation={conversation}
          messages={messages}
          hasOlderMessages={hasOlderMessages}
          loadingOlderMessages={loadingOlderMessages}
          onLoadOlderMessages={loadOlderMessages}
          counterpartTyping={typing.counterpartTyping}
          counterpartLeaving={typing.counterpartLeaving}
          canCompose={canCompose}
          onRetry={retry}
          onDiscard={discard}
        />
      </MessageParticipantsProvider>
      {canCompose ? (
        <MiniComposer
          key={conversation.id}
          draftKey={roomDraftKey(conversation.viewerId, conversation.id)}
          onDraftChange={typing.reportDraft}
          onSend={(prepared) => {
            typing.reportSent();
            void send({
              body: prepared.body,
              mentionPubIds: prepared.mentionPubIds,
              mentionsEveryone: prepared.mentionsEveryone,
            });
          }}
          onLike={() => void send({ body: "👍" })}
          onSendFiles={(files) => void sendFiles(files)}
        />
      ) : (
        <p className="shrink-0 border-t px-4 py-3 text-center text-sm text-muted-foreground">
          {isDirectCounterpartWithdrawn(conversation)
            ? "탈퇴한 사용자에게는 메시지를 보낼 수 없습니다."
            : isViewerActive(conversation)
              ? "이 채팅에는 메시지를 보낼 수 없습니다."
              : "이 채팅에서 나왔습니다. 참여한 동안의 메시지만 볼 수 있습니다."}
        </p>
      )}
    </MiniRoomFrame>
  );
}

/**
 * 메시지 목록. 대화방의 목록과 같은 흐름 구분선·묶음·시스템 메시지 규칙(기능 명세 §13.3)을 쓰되, 메시지
 * 옆 작업 버튼과 메뉴는 두지 않는다.
 */
function MiniThread({
  conversation,
  messages,
  hasOlderMessages,
  loadingOlderMessages,
  onLoadOlderMessages,
  counterpartTyping,
  counterpartLeaving,
  canCompose,
  onRetry,
  onDiscard,
}: {
  conversation: Conversation;
  messages: ConversationMessage[];
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  onLoadOlderMessages: () => Promise<OlderMessagesResult>;
  counterpartTyping: boolean;
  counterpartLeaving: boolean;
  canCompose: boolean;
  onRetry: (message: ConversationMessage) => void;
  onDiscard: (message: ConversationMessage) => void;
}) {
  const threadRef = useRef<HTMLDivElement>(null);
  // 맨 아래를 보고 있는지. 열 때는 맨 아래에서 시작한다.
  const following = useRef(true);
  // 앞선 페이지를 붙이기 전 바닥에서의 거리. 붙은 뒤 같은 거리로 되돌려 보던 메시지가 밀리지 않게 한다.
  const olderAnchor = useRef<number | null>(null);
  const layout = useMemo(() => layoutMessageThread(messages), [messages]);
  const participantById = useMemo(
    () =>
      new Map(
        conversation.participants.map((participant) => [
          participant.id,
          participant,
        ]),
      ),
    [conversation.participants],
  );

  useLayoutEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    if (olderAnchor.current !== null) {
      thread.scrollTop = thread.scrollHeight - olderAnchor.current;
      olderAnchor.current = null;
      return;
    }
    if (following.current) thread.scrollTop = thread.scrollHeight;
  }, [messages, counterpartTyping]);

  const onScroll = () => {
    const thread = threadRef.current;
    if (!thread) return;
    following.current =
      thread.scrollHeight - thread.scrollTop - thread.clientHeight <
      FOLLOW_NEW_MESSAGES_THRESHOLD;
    if (
      thread.scrollTop < OLDER_MESSAGES_THRESHOLD &&
      hasOlderMessages &&
      !loadingOlderMessages &&
      olderAnchor.current === null
    ) {
      olderAnchor.current = thread.scrollHeight - thread.scrollTop;
      void onLoadOlderMessages().then((result) => {
        if (result !== "loaded") olderAnchor.current = null;
      });
    }
  };

  return (
    <div
      ref={threadRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-3"
      onScroll={onScroll}
    >
      {loadingOlderMessages ? (
        <div role="status" className="flex justify-center py-2">
          <Spinner />
          <span className="sr-only">이전 메시지를 불러오는 중</span>
        </div>
      ) : null}
      <div className="flex min-h-full flex-col justify-end gap-0.5">
        {messages.map((message, index) => {
          const slot = layout[index];
          const sender = message.senderId
            ? participantById.get(message.senderId)
            : undefined;
          const replyTargetAuthor = message.replyTo?.senderId
            ? participantById.get(message.replyTo.senderId)?.name
            : undefined;
          return (
            <div key={message.id}>
              {slot?.startsSession ? (
                <div className="my-3 flex items-center justify-center">
                  <span className="text-xs text-muted-foreground">
                    {formatMessageSessionStart(message.sentAt)}
                  </span>
                </div>
              ) : null}
              {message.system ? (
                <p className="mx-auto my-2 w-fit max-w-[85%] rounded-xl bg-muted/60 px-3 py-1 text-center text-xs text-muted-foreground">
                  {formatSystemMessage(message.system, participantById)}
                </p>
              ) : (
                <>
                  <MessageRow
                    message={message}
                    sender={sender}
                    isOwn={message.senderId === conversation.viewerId}
                    isGroup={conversation.type === "group"}
                    startsGroup={slot?.startsGroup ?? true}
                    endsGroup={slot?.endsGroup ?? true}
                    isPinned={message.pinned ?? false}
                    // 삭제된 메시지는 읽었는지 알 필요가 없다.
                    unreadParticipantCount={
                      message.deleted ? 0 : (message.unreadMemberCount ?? 0)
                    }
                    replyTarget={message.replyTo ?? undefined}
                    replyTargetAuthor={replyTargetAuthor}
                    contextViewportRef={threadRef}
                  />
                  {message.failed ? (
                    <div className="mt-0.5 mb-1 flex items-center justify-end gap-1 text-xs">
                      <span className="text-destructive">
                        보내지 못했습니다
                      </span>
                      {canCompose ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => onRetry(message)}
                        >
                          다시 보내기
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground"
                        onClick={() => onDiscard(message)}
                      >
                        지우기
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
        {counterpartTyping || counterpartLeaving ? (
          <TypingIndicator
            leaving={counterpartLeaving}
            participant={directCounterpart(conversation)}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * 글, 좋아요, 사진·파일을 보내는 입력창. 쓰던 글은 대화방과 같은 초안 저장소에 두어 `크게 열기`로 옮겨도
 * 이어진다. 멘션 자동완성은 없지만 초안에 남아 있던 멘션은 그대로 보낸다. 고른 파일은 쌓아 두지 않고
 * 바로 보낸다.
 */
function MiniComposer({
  draftKey,
  onDraftChange,
  onSend,
  onLike,
  onSendFiles,
}: {
  draftKey: string;
  onDraftChange: (draft: string) => void;
  onSend: (message: PreparedMessageMentions) => void;
  onLike: () => void;
  /** 고른 사진·파일을 보낸다. 수와 종류 제한은 대화방과 같다(기능 명세 §13.5). */
  onSendFiles: (files: File[]) => void;
}) {
  const [draft, setDraft] = useState(() => readRoomDraft(draftKey)?.text ?? "");
  const mentions = useRef<MentionDraftEntry[]>(
    readRoomDraft(draftKey)?.mentions ?? [],
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const lastSentAt = useRef(0);
  const lastTextSentAt = useRef(0);
  const hasDraft = draft.trim() !== "";

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
  }, []);

  const claimSend = () => {
    const now = Date.now();
    if (now - lastSentAt.current < SEND_COOLDOWN_MS) return false;
    lastSentAt.current = now;
    return true;
  };

  const clearDraft = () => {
    setDraft("");
    mentions.current = [];
    updateRoomDraft(draftKey, { text: "", mentions: [] });
  };

  // 같은 파일을 다시 골라도 change가 나도록 값은 비운다.
  const pickFiles = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length > 0) onSendFiles(files);
  };

  const sendDraft = () => {
    const prepared = prepareMessageMentions(
      normalizeMessageBody(draft),
      mentions.current,
    );
    if (prepared.body.trim() === "" || !claimSend()) return;
    lastTextSentAt.current = Date.now();
    onSend(prepared);
    clearDraft();
  };

  return (
    <footer className="flex shrink-0 items-end gap-0.5 border-t px-2 py-2">
      <input
        ref={mediaInput}
        type="file"
        accept={MEDIA_INPUT_ACCEPT}
        multiple
        hidden
        aria-hidden
        tabIndex={-1}
        onChange={(event) => pickFiles(event.currentTarget)}
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        aria-hidden
        tabIndex={-1}
        onChange={(event) => pickFiles(event.currentTarget)}
      />
      <Button
        variant="ghost"
        size="icon"
        className="mb-0.5 shrink-0 rounded-full"
        aria-label="파일 보내기"
        onClick={() => fileInput.current?.click()}
      >
        <PaperclipIcon aria-hidden className="size-5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="mb-0.5 shrink-0 rounded-full"
        aria-label="사진 보내기"
        onClick={() => mediaInput.current?.click()}
      >
        <ImageIcon aria-hidden className="size-5" />
      </Button>
      <textarea
        ref={textareaRef}
        rows={1}
        value={draft}
        aria-label="메시지 입력"
        placeholder="메시지 입력"
        className="field-sizing-content max-h-32 min-h-10 min-w-0 flex-1 resize-none rounded-[1.25rem] bg-muted px-3.5 py-2 text-[15px] leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        onChange={(event) => {
          const value = event.currentTarget.value;
          setDraft(value);
          updateRoomDraft(draftKey, {
            text: value,
            mentions: mentions.current,
          });
          onDraftChange(value);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          // 폰·태블릿의 Enter는 줄바꿈이다. 조합 중의 Enter는 입력기 확정이다.
          if (!isSendEnter(event)) return;
          if (
            composing.current ||
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          ) {
            return;
          }
          event.preventDefault();
          sendDraft();
        }}
      />
      <Button
        variant="ghost"
        size="icon-lg"
        className={cn("shrink-0 rounded-full text-primary")}
        aria-label={hasDraft ? "메시지 보내기" : "좋아요 보내기"}
        // 누르는 순간 입력창이 포커스를 잃지 않게 한다.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (hasDraft) {
            sendDraft();
            return;
          }
          if (Date.now() - lastTextSentAt.current < LIKE_AFTER_SEND_MS) return;
          if (!claimSend()) return;
          onLike();
          // 공백만 있던 입력은 좋아요와 함께 비운다.
          clearDraft();
        }}
      >
        {hasDraft ? (
          <SendIcon aria-hidden className="size-6" />
        ) : (
          <ThumbsUpIcon aria-hidden className="size-6" />
        )}
      </Button>
    </footer>
  );
}
