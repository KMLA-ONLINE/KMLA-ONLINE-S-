import {
  ChevronDownIcon,
  CopyIcon,
  EllipsisIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageIcon,
  InfoIcon,
  PaperclipIcon,
  PinIcon,
  ReplyIcon,
  SearchIcon,
  SendIcon,
  SmileIcon,
  ThumbsUpIcon,
  XIcon,
} from "lucide-react";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";

import { ConversationAvatar } from "~/features/messaging/components/conversation-avatar";
import { ConversationDetails } from "~/features/messaging/components/conversation-details";
import { copyMessageText } from "~/features/messaging/components/copy-message";
import {
  MessageActionRail,
  MessageRow,
} from "~/features/messaging/components/message-row";
import { PinnedMessagesDialog } from "~/features/messaging/components/pinned-messages-dialog";
import { useConversationMessages } from "~/features/messaging/hooks/use-conversation-messages";
import {
  canConnectMessages,
  hasVisibleMessageReaction,
} from "~/features/messaging/model/message-grouping";
import {
  formatMessageDay,
  startsMessageDay,
} from "~/features/messaging/model/message-time";
import type {
  Conversation,
  ConversationMessage,
} from "~/features/messaging/model/types";
import {
  countMessageGraphemes,
  MESSAGE_MAX_LENGTH,
  normalizeMessageBody,
} from "~/features/messaging/model/message-text";
import {
  QuickReactionBar,
  ReactionPickerSurface,
} from "~/features/posts/components/reaction/quick-reaction-bar";
import type { PostReaction } from "~/features/posts/model/types";
import { Button } from "~/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";
import { cn } from "~/shared/lib/utils";

export interface DesktopDetailsContext {
  desktopDetailsOpen: boolean;
  setDesktopDetailsOpen: Dispatch<SetStateAction<boolean>>;
}

const BOTTOM_SCROLL_BUTTON_THRESHOLD = 200;
/** 맨 위에서 이만큼 남았을 때 앞선 메시지를 미리 읽는다. */
const OLDER_MESSAGES_THRESHOLD = 400;

export function RoomScreen({
  conversation,
  desktopDetailsOpen = true,
  onDesktopDetailsOpenChange,
}: {
  conversation: Conversation;
  desktopDetailsOpen?: boolean;
  onDesktopDetailsOpenChange?: (open: boolean) => void;
}) {
  const [compactDetailsOpen, setCompactDetailsOpen] = useState(false);
  const [pinnedDialogOpen, setPinnedDialogOpen] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null);
  const {
    messages,
    hasOlderMessages,
    loadingOlderMessages,
    loadOlderMessages,
    send,
    react,
    togglePinned,
  } = useConversationMessages(conversation);
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const messageThreadRef = useRef<HTMLDivElement>(null);
  const scrollToBottomAfterSend = useRef(false);
  const pinnedMessages = messages.filter((message) => message.pinned);
  const pinnedMessage = pinnedMessages.at(-1);
  const pinnedMessageAuthor = pinnedMessage?.senderId
    ? (conversation.participants.find(({ id }) => id === pinnedMessage.senderId)
        ?.name ?? "알 수 없는 사용자")
    : null;
  const replyTarget = messages.find(({ id }) => id === replyTargetId);
  const replyAuthor = replyTarget?.senderId
    ? (conversation.participants.find(({ id }) => id === replyTarget.senderId)
        ?.name ?? "알 수 없는 사용자")
    : null;

  useEffect(() => {
    if (!highlightedMessageId) return;
    const timeout = window.setTimeout(
      () => setHighlightedMessageId(null),
      1600,
    );
    return () => window.clearTimeout(timeout);
  }, [highlightedMessageId]);

  useEffect(() => {
    const messageThread = messageThreadRef.current;
    if (messageThread) messageThread.scrollTop = messageThread.scrollHeight;
  }, [conversation.id]);

  useEffect(() => {
    if (!scrollToBottomAfterSend.current) return;
    const messageThread = messageThreadRef.current;
    if (messageThread) messageThread.scrollTop = messageThread.scrollHeight;
    scrollToBottomAfterSend.current = false;
  }, [messages]);

  function viewMessage(messageId: string) {
    setPinnedDialogOpen(false);
    setCompactDetailsOpen(false);
    setHighlightedMessageId(messageId);
    requestAnimationFrame(() => {
      document
        .getElementById(`message-${messageId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function sendMessage(body: string) {
    scrollToBottomAfterSend.current = true;
    const sending = send(body, replyTargetId ?? undefined);
    setReplyTargetId(null);
    return sending;
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <section
        aria-label={`${conversation.name} 대화`}
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col bg-background",
          compactDetailsOpen ? "hidden xl:flex" : "flex",
        )}
      >
        <header className="z-10 flex h-[calc(var(--app-page-header-h)+var(--app-safe-t))] shrink-0 items-center gap-2 bg-background/95 px-2 pt-[var(--app-safe-t)] shadow-sm backdrop-blur md:h-16 md:px-4 md:pt-0">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full md:hidden"
            aria-label="대화 목록으로 돌아가기"
            nativeButton={false}
            render={<Link to="/messenger" />}
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
          <ConversationAvatar conversation={conversation} className="size-10" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold md:text-base">
              {conversation.name}
            </h1>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label="대화 검색 기능 준비 중"
            disabled
          >
            <SearchIcon aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full xl:hidden"
            aria-label="대화 정보 열기"
            onClick={() => setCompactDetailsOpen(true)}
          >
            <InfoIcon aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden rounded-full xl:inline-flex"
            aria-label={
              desktopDetailsOpen ? "대화 정보 닫기" : "대화 정보 열기"
            }
            aria-pressed={desktopDetailsOpen}
            onClick={() => onDesktopDetailsOpenChange?.(!desktopDetailsOpen)}
          >
            <InfoIcon aria-hidden />
          </Button>
        </header>

        {pinnedMessage ? (
          <button
            type="button"
            aria-label="고정 메시지"
            className="flex min-h-14 shrink-0 items-center gap-3 border-t border-b bg-muted/40 px-4 py-2.5 text-left hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => setPinnedDialogOpen(true)}
          >
            <PinIcon aria-hidden className="size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">
                {pinnedMessageAuthor ?? "알 수 없는 사용자"}
              </p>
              <p className="truncate text-sm text-muted-foreground">
                {pinnedMessage.deleted
                  ? "삭제된 메시지입니다"
                  : pinnedMessage.body}
              </p>
            </div>
          </button>
        ) : null}

        <MessageThread
          conversation={conversation}
          messages={messages}
          highlightedMessageId={highlightedMessageId}
          messageThreadRef={messageThreadRef}
          desktopDetailsOpen={desktopDetailsOpen}
          hasOlderMessages={hasOlderMessages}
          loadingOlderMessages={loadingOlderMessages}
          onLoadOlderMessages={loadOlderMessages}
          onSelectReaction={react}
          onReply={(message) => {
            if (!message.deleted) setReplyTargetId(message.id);
          }}
          onTogglePinned={togglePinned}
          onViewMessage={viewMessage}
        />
        <ComposerShell
          replyTarget={replyTarget}
          replyAuthor={replyAuthor}
          onCancelReply={() => setReplyTargetId(null)}
          onSend={sendMessage}
          desktopDetailsOpen={desktopDetailsOpen}
        />
      </section>

      <ConversationDetails
        conversation={conversation}
        onMobileBack={() => setCompactDetailsOpen(false)}
        pinnedCount={pinnedMessages.length}
        onOpenPinnedMessages={() => setPinnedDialogOpen(true)}
        className={cn(
          compactDetailsOpen ? "flex xl:hidden" : "hidden",
          compactDetailsOpen &&
            "md:absolute md:inset-y-0 md:right-0 md:shadow-xl xl:static xl:shadow-none",
          desktopDetailsOpen ? "xl:flex" : "xl:hidden",
        )}
      />
      <PinnedMessagesDialog
        open={pinnedDialogOpen}
        messages={messages}
        participants={conversation.participants}
        viewerId={conversation.viewerId}
        isGroup={conversation.type === "group"}
        onOpenChange={setPinnedDialogOpen}
        onViewMessage={viewMessage}
        onUnpin={togglePinned}
      />
    </div>
  );
}

function MessageThread({
  conversation,
  messages,
  highlightedMessageId,
  messageThreadRef,
  desktopDetailsOpen,
  hasOlderMessages,
  loadingOlderMessages,
  onLoadOlderMessages,
  onSelectReaction,
  onReply,
  onTogglePinned,
  onViewMessage,
}: {
  conversation: Conversation;
  messages: ConversationMessage[];
  highlightedMessageId: string | null;
  messageThreadRef: RefObject<HTMLDivElement | null>;
  desktopDetailsOpen: boolean;
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  onLoadOlderMessages: () => void;
  onSelectReaction: (
    message: ConversationMessage,
    reaction: PostReaction,
  ) => void;
  onReply: (message: ConversationMessage) => void;
  onTogglePinned: (message: ConversationMessage) => void;
  onViewMessage: (messageId: string) => void;
}) {
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const scrollingToBottom = useRef(false);
  const previousScrollTop = useRef(0);
  const contextPortalRef = useRef<HTMLDivElement>(null);
  const participantById = new Map(
    conversation.participants.map((participant) => [
      participant.id,
      participant,
    ]),
  );
  const messageById = new Map(messages.map((message) => [message.id, message]));
  // 앞선 페이지를 위에 붙이면 scrollHeight만 늘고 scrollTop은 그대로라 보던 메시지가 아래로
  // 밀린다. 붙이기 전 바닥에서의 거리를 기억했다가 붙인 뒤 같은 거리로 되돌린다.
  const distanceFromBottomBeforeOlder = useRef<number | null>(null);
  const oldestMessageId = messages[0]?.id;

  useLayoutEffect(() => {
    const messageThread = messageThreadRef.current;
    const distance = distanceFromBottomBeforeOlder.current;
    if (!messageThread || distance === null) return;
    messageThread.scrollTop = messageThread.scrollHeight - distance;
    distanceFromBottomBeforeOlder.current = null;
  }, [oldestMessageId, messageThreadRef]);

  function maybeLoadOlderMessages() {
    const messageThread = messageThreadRef.current;
    if (
      !messageThread ||
      !hasOlderMessages ||
      loadingOlderMessages ||
      messageThread.scrollTop > OLDER_MESSAGES_THRESHOLD
    )
      return;
    distanceFromBottomBeforeOlder.current =
      messageThread.scrollHeight - messageThread.scrollTop;
    onLoadOlderMessages();
  }

  function updateScrollToBottomVisibility() {
    const messageThread = messageThreadRef.current;
    if (!messageThread) return;
    const distanceFromBottom =
      messageThread.scrollHeight -
      messageThread.clientHeight -
      messageThread.scrollTop;

    if (scrollingToBottom.current) {
      if (
        messageThread.scrollTop < previousScrollTop.current ||
        distanceFromBottom <= BOTTOM_SCROLL_BUTTON_THRESHOLD
      ) {
        scrollingToBottom.current = false;
        setShowScrollToBottom(
          distanceFromBottom > BOTTOM_SCROLL_BUTTON_THRESHOLD,
        );
      }
      previousScrollTop.current = messageThread.scrollTop;
      return;
    }

    setShowScrollToBottom(distanceFromBottom > BOTTOM_SCROLL_BUTTON_THRESHOLD);
  }

  function scrollToBottom() {
    const messageThread = messageThreadRef.current;
    if (!messageThread) return;
    scrollingToBottom.current = true;
    previousScrollTop.current = messageThread.scrollTop;
    messageThread.scrollTo({
      top: messageThread.scrollHeight,
      behavior: "smooth",
    });
    setShowScrollToBottom(false);
  }

  return (
    <div className="relative isolate flex min-h-0 flex-1 flex-col">
      <div
        ref={messageThreadRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 md:px-5"
        onScroll={() => {
          updateScrollToBottomVisibility();
          maybeLoadOlderMessages();
        }}
      >
        <div
          className={cn(
            "mx-auto flex min-h-full max-w-3xl flex-col justify-start gap-0.5",
            !desktopDetailsOpen && "xl:max-w-none",
          )}
        >
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const next = messages[index + 1];
            const startsGroup = !canConnectMessages(
              previous,
              message,
              previous ? hasVisibleMessageReaction(previous) : false,
            );
            const endsGroup = !canConnectMessages(
              message,
              next,
              hasVisibleMessageReaction(message),
            );
            const sender = message.senderId
              ? participantById.get(message.senderId)
              : undefined;
            const replyTarget = message.replyToMessageId
              ? messageById.get(message.replyToMessageId)
              : undefined;
            const replyTargetAuthor = replyTarget?.senderId
              ? participantById.get(replyTarget.senderId)?.name
              : undefined;

            return (
              <div key={message.id}>
                {startsMessageDay(previous, message) ? (
                  <div className="my-4 flex items-center justify-center">
                    <span className="text-xs text-muted-foreground">
                      {formatMessageDay(message.sentAt)}
                    </span>
                  </div>
                ) : null}
                {message.system ? (
                  <p className="my-3 text-center text-xs text-muted-foreground">
                    {message.body}
                  </p>
                ) : (
                  <MessageRow
                    message={message}
                    sender={sender}
                    isOwn={message.senderId === conversation.viewerId}
                    isGroup={conversation.type === "group"}
                    unreadParticipantCount={message.unreadMemberCount ?? 0}
                    startsGroup={startsGroup}
                    endsGroup={endsGroup}
                    isPinned={message.pinned ?? false}
                    highlighted={highlightedMessageId === message.id}
                    elementId={`message-${message.id}`}
                    contextViewportRef={messageThreadRef}
                    contextPortalRef={contextPortalRef}
                    replyTarget={replyTarget}
                    replyTargetAuthor={replyTargetAuthor}
                    onViewReply={
                      replyTarget
                        ? () => onViewMessage(replyTarget.id)
                        : undefined
                    }
                    onReply={
                      message.deleted ? undefined : () => onReply(message)
                    }
                    onSelectReaction={(reaction) =>
                      onSelectReaction(message, reaction)
                    }
                    contextActions={[
                      ...(message.deleted
                        ? []
                        : [
                            {
                              label: "답장",
                              icon: <ReplyIcon aria-hidden />,
                              onSelect: () => onReply(message),
                            },
                          ]),
                      ...(message.deleted
                        ? []
                        : [
                            {
                              label: "복사",
                              icon: <CopyIcon aria-hidden />,
                              onSelect: () =>
                                void copyMessageText(message.body),
                            },
                          ]),
                      {
                        label: message.pinned ? "고정 해제" : "고정",
                        icon: <PinIcon aria-hidden />,
                        onSelect: () => onTogglePinned(message),
                      },
                    ]}
                    actionRail={
                      <MessageActions
                        isOwn={message.senderId === conversation.viewerId}
                        message={message}
                        isPinned={message.pinned ?? false}
                        onSelectReaction={(reaction) =>
                          onSelectReaction(message, reaction)
                        }
                        onReply={() => onReply(message)}
                        onTogglePinned={() => onTogglePinned(message)}
                      />
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {showScrollToBottom ? (
        <Button
          variant="secondary"
          size="icon"
          className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border-border bg-background/95 shadow-md backdrop-blur"
          aria-label="맨 아래로 이동"
          onClick={scrollToBottom}
        >
          <ChevronDownIcon aria-hidden className="size-5" />
        </Button>
      ) : null}
      <div
        ref={contextPortalRef}
        data-slot="message-context-portal"
        className="contents"
      />
    </div>
  );
}

function MessageActions({
  isOwn,
  message,
  isPinned,
  onSelectReaction,
  onReply,
  onTogglePinned,
}: {
  isOwn: boolean;
  message: ConversationMessage;
  isPinned: boolean;
  onSelectReaction: (reaction: PostReaction) => void;
  onReply: () => void;
  onTogglePinned: () => void;
}) {
  const [reactionOpen, setReactionOpen] = useState(false);

  const reactionAction = (
    <div className="relative flex shrink-0">
      {reactionOpen ? (
        <ReactionPickerSurface
          onDismiss={() => setReactionOpen(false)}
          className="left-1/2 mb-2 -translate-x-1/2"
        >
          <QuickReactionBar
            current={message.myReaction}
            onSelect={(reaction) => {
              setReactionOpen(false);
              onSelectReaction(reaction);
            }}
          />
        </ReactionPickerSurface>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-full text-muted-foreground"
        aria-label="메시지에 반응"
        aria-expanded={reactionOpen}
        onClick={() => setReactionOpen((open) => !open)}
      >
        <SmileIcon aria-hidden />
      </Button>
    </div>
  );
  const replyAction = (
    <Button
      variant="ghost"
      size="icon-sm"
      className="rounded-full text-muted-foreground"
      aria-label="메시지에 답장"
      onClick={onReply}
    >
      <ReplyIcon aria-hidden />
    </Button>
  );
  const moreAction = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground"
            aria-label="메시지 기타 작업"
          />
        }
      >
        <EllipsisIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="center"
        className="shadow-sm duration-0 data-open:animate-none data-closed:animate-none"
      >
        <DropdownMenuGroup>
          {!message.deleted ? (
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => void copyMessageText(message.body)}
            >
              <CopyIcon aria-hidden />
              복사
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem className="cursor-pointer" onClick={onTogglePinned}>
            <PinIcon aria-hidden />
            {isPinned ? "고정 해제" : "고정"}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <MessageActionRail>
      {isOwn ? (
        <>
          {moreAction}
          {!message.deleted ? replyAction : null}
          {reactionAction}
        </>
      ) : (
        <>
          {reactionAction}
          {!message.deleted ? replyAction : null}
          {moreAction}
        </>
      )}
    </MessageActionRail>
  );
}

function ComposerShell({
  replyTarget,
  replyAuthor,
  onCancelReply,
  onSend,
  desktopDetailsOpen,
}: {
  replyTarget?: ConversationMessage;
  replyAuthor: string | null;
  onCancelReply: () => void;
  /** 실패하면 false로 끝난다. 작성창은 비워 둔 입력을 되살린다. */
  onSend: (body: string) => Promise<boolean>;
  desktopDetailsOpen: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [attachmentActionsExpanded, setAttachmentActionsExpanded] =
    useState(false);
  const composing = useRef(false);
  const normalizedDraft = normalizeMessageBody(draft);
  const hasDraft = normalizedDraft.trim() !== "";
  const draftLength = countMessageGraphemes(normalizedDraft);
  const overLimit = draftLength > MESSAGE_MAX_LENGTH;
  const attachmentActionsCollapsed = hasDraft && !attachmentActionsExpanded;

  function sendDraft(): boolean {
    if (!hasDraft || overLimit) return false;
    const body = normalizedDraft;
    void onSend(body).then((sent) => {
      // 그새 새로 쓰기 시작했으면 덮어쓰지 않는다.
      if (!sent) setDraft((current) => (current === "" ? body : current));
    });
    setDraft("");
    setAttachmentActionsExpanded(false);
    return true;
  }

  function changeDraft(value: string) {
    setDraft(value);
    if (normalizeMessageBody(value).trim() === "") {
      setAttachmentActionsExpanded(false);
    }
  }

  return (
    <footer className="shrink-0 bg-background px-2 pt-2 pb-[calc(0.5rem+var(--app-safe-b))] md:px-3 md:pb-3">
      {replyTarget ? (
        <div
          className={cn(
            "mx-auto mb-2 flex max-w-3xl items-center gap-2 border-l-2 border-primary px-3 py-1",
            !desktopDetailsOpen && "xl:max-w-none",
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-primary">
              {replyAuthor ?? "알 수 없는 사용자"}에게 답장
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {replyTarget.body}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            className="rounded-full"
            aria-label="답장 취소"
            onClick={onCancelReply}
          >
            <XIcon aria-hidden />
          </Button>
        </div>
      ) : null}
      <div
        className={cn(
          "mx-auto flex max-w-3xl items-end gap-1.5",
          !desktopDetailsOpen && "xl:max-w-none",
        )}
      >
        <div
          aria-hidden={attachmentActionsCollapsed}
          className={cn(
            "flex shrink-0 items-end gap-1.5 transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none",
            attachmentActionsCollapsed
              ? "w-0 overflow-hidden opacity-0"
              : "w-[5.5rem] opacity-100",
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="mb-0.5 rounded-full"
            aria-label="사진 첨부 기능 준비 중"
            disabled
          >
            <ImageIcon aria-hidden className="size-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="mb-0.5 rounded-full"
            aria-label="파일 첨부 기능 준비 중"
            disabled
          >
            <PaperclipIcon aria-hidden className="size-5" />
          </Button>
        </div>
        {attachmentActionsCollapsed ? (
          <Button
            variant="ghost"
            size="icon"
            className="mb-0.5 shrink-0 rounded-full"
            aria-label="첨부 메뉴 펼치기"
            onClick={() => setAttachmentActionsExpanded(true)}
          >
            <ChevronRightIcon aria-hidden className="size-5" />
          </Button>
        ) : null}
        <div className="flex min-h-10 min-w-0 flex-1 items-end gap-2 rounded-3xl bg-muted py-2 pr-3 pl-4">
          <textarea
            rows={1}
            value={draft}
            aria-label="메시지 입력"
            placeholder="메시지 입력"
            className="field-sizing-content max-h-32 min-h-6 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
            onChange={(event) => changeDraft(event.currentTarget.value)}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => (composing.current = false)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return;
              // Safari는 compositionend를 Enter keydown보다 먼저 보내 isComposing도 false다.
              // 그 keydown은 keyCode 229로 온다.
              if (
                composing.current ||
                event.nativeEvent.isComposing ||
                event.keyCode === 229
              )
                return;
              event.preventDefault();
              sendDraft();
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="-m-1 hidden shrink-0 rounded-full text-primary md:inline-flex"
            aria-label="이모지 선택 기능 준비 중"
            disabled
          >
            <SmileIcon aria-hidden className="size-5" />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="mb-0.5 rounded-full text-primary"
          aria-label={hasDraft ? "메시지 보내기" : "좋아요 보내기"}
          disabled={overLimit}
          onClick={() => {
            if (hasDraft) {
              sendDraft();
              return;
            }
            void onSend("👍");
            // 공백만 있던 입력은 좋아요와 함께 비운다.
            setDraft("");
          }}
        >
          {hasDraft ? (
            <SendIcon aria-hidden className="size-5" />
          ) : (
            <ThumbsUpIcon aria-hidden className="size-5" />
          )}
        </Button>
      </div>
      {overLimit ? (
        <p
          role="alert"
          className={cn(
            "mx-auto mt-1 max-w-3xl px-3 text-xs text-destructive",
            !desktopDetailsOpen && "xl:max-w-none",
          )}
        >
          메시지는 {MESSAGE_MAX_LENGTH.toLocaleString("ko-KR")}자까지 쓸 수
          있습니다. ({draftLength.toLocaleString("ko-KR")})
        </p>
      ) : null}
    </footer>
  );
}
