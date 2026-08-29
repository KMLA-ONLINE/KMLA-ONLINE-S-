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
  useRef,
  useState,
} from "react";
import { Link } from "react-router";

import { ConversationAvatar } from "~/features/messaging/components/conversation-avatar";
import { ConversationDetails } from "~/features/messaging/components/conversation-details";
import {
  MessageActionRail,
  MessageRow,
} from "~/features/messaging/components/message-row";
import { PinnedMessagesDialog } from "~/features/messaging/components/pinned-messages-dialog";
import {
  canConnectMessages,
  nextMessageDayLabel,
  hasVisibleMessageReaction,
} from "~/features/messaging/model/message-grouping";
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
} from "~/features/posts/components/quick-reaction-bar";
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
  const [messages, setMessages] = useState(conversation.messages);
  const [selectedReactions, setSelectedReactions] = useState<
    Record<string, PostReaction | null>
  >({});
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

  function selectReaction(messageId: string, reaction: PostReaction) {
    setSelectedReactions((current) => ({
      ...current,
      [messageId]: current[messageId] === reaction ? null : reaction,
    }));
  }

  function togglePinned(message: ConversationMessage) {
    setMessages((current) =>
      current.map((item) =>
        item.id === message.id ? { ...item, pinned: !item.pinned } : item,
      ),
    );
  }

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
    const sentAt = new Date();
    scrollToBottomAfterSend.current = true;
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        senderId: "viewer",
        body,
        sentAt: new Intl.DateTimeFormat("ko-KR", {
          hour: "numeric",
          minute: "2-digit",
        }).format(sentAt),
        dayLabel: nextMessageDayLabel(current, sentAt),
        replyToMessageId: replyTargetId ?? undefined,
        readBy: [],
      },
    ]);
    setReplyTargetId(null);
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
                {pinnedMessage.body}
              </p>
            </div>
          </button>
        ) : null}

        <MessageThread
          conversation={conversation}
          messages={messages}
          selectedReactions={selectedReactions}
          highlightedMessageId={highlightedMessageId}
          messageThreadRef={messageThreadRef}
          desktopDetailsOpen={desktopDetailsOpen}
          onSelectReaction={selectReaction}
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
  selectedReactions,
  highlightedMessageId,
  messageThreadRef,
  desktopDetailsOpen,
  onSelectReaction,
  onReply,
  onTogglePinned,
  onViewMessage,
}: {
  conversation: Conversation;
  messages: ConversationMessage[];
  selectedReactions: Record<string, PostReaction | null>;
  highlightedMessageId: string | null;
  messageThreadRef: RefObject<HTMLDivElement | null>;
  desktopDetailsOpen: boolean;
  onSelectReaction: (messageId: string, reaction: PostReaction) => void;
  onReply: (message: ConversationMessage) => void;
  onTogglePinned: (message: ConversationMessage) => void;
  onViewMessage: (messageId: string) => void;
}) {
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const scrollingToBottom = useRef(false);
  const previousScrollTop = useRef(0);
  const participantById = new Map(
    conversation.participants.map((participant) => [
      participant.id,
      participant,
    ]),
  );

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
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={messageThreadRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 md:px-5"
        onScroll={updateScrollToBottomVisibility}
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
              previous
                ? hasVisibleMessageReaction(
                    previous,
                    selectedReactions[previous.id],
                  )
                : false,
            );
            const endsGroup = !canConnectMessages(
              message,
              next,
              hasVisibleMessageReaction(message, selectedReactions[message.id]),
            );
            const sender = message.senderId
              ? participantById.get(message.senderId)
              : undefined;
            const replyTarget = message.replyToMessageId
              ? messages.find(({ id }) => id === message.replyToMessageId)
              : undefined;
            const replyTargetAuthor = replyTarget?.senderId
              ? participantById.get(replyTarget.senderId)?.name
              : undefined;

            return (
              <div key={message.id}>
                {message.dayLabel ? (
                  <div className="my-4 flex items-center justify-center">
                    <span className="text-xs text-muted-foreground">
                      {message.dayLabel}
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
                    isOwn={message.senderId === "viewer"}
                    isGroup={conversation.type === "group"}
                    unreadParticipantCount={Math.max(
                      0,
                      conversation.participants.length -
                        1 -
                        (message.readBy?.length ?? 0),
                    )}
                    startsGroup={startsGroup}
                    endsGroup={endsGroup}
                    showTimestamp={endsGroup}
                    selectedReaction={selectedReactions[message.id]}
                    isPinned={message.pinned ?? false}
                    highlighted={highlightedMessageId === message.id}
                    elementId={`message-${message.id}`}
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
                    actionRail={
                      <MessageActions
                        isOwn={message.senderId === "viewer"}
                        message={message}
                        selectedReaction={selectedReactions[message.id]}
                        isPinned={message.pinned ?? false}
                        onSelectReaction={(reaction) =>
                          onSelectReaction(message.id, reaction)
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
    </div>
  );
}

function MessageActions({
  isOwn,
  message,
  selectedReaction,
  isPinned,
  onSelectReaction,
  onReply,
  onTogglePinned,
}: {
  isOwn: boolean;
  message: ConversationMessage;
  selectedReaction?: PostReaction | null;
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
            current={selectedReaction}
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
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => void navigator.clipboard.writeText(message.body)}
          >
            <CopyIcon aria-hidden />
            복사
          </DropdownMenuItem>
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
  onSend: (body: string) => void;
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
    onSend(normalizedDraft);
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
              if (composing.current || event.nativeEvent.isComposing) return;
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
            if (hasDraft) sendDraft();
            else onSend("👍");
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
