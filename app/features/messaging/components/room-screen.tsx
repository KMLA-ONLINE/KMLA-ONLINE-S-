import {
  CopyIcon,
  EllipsisIcon,
  FilePlus2Icon,
  ChevronLeftIcon,
  ImagePlusIcon,
  InfoIcon,
  PinIcon,
  ReplyIcon,
  SearchIcon,
  SendIcon,
  SmileIcon,
  ThumbsUpIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

export function RoomScreen({ conversation }: { conversation: Conversation }) {
  const [desktopDetailsOpen, setDesktopDetailsOpen] = useState(true);
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
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        senderId: "viewer",
        body,
        sentAt: new Intl.DateTimeFormat("ko-KR", {
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date()),
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
        <header className="flex h-[calc(var(--app-page-header-h)+var(--app-safe-t))] shrink-0 items-center gap-2 bg-background/95 px-2 pt-[var(--app-safe-t)] backdrop-blur md:h-16 md:px-4 md:pt-0">
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
            onClick={() => setDesktopDetailsOpen((open) => !open)}
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
          onSelectReaction={selectReaction}
          onReply={(message) => setReplyTargetId(message.id)}
          onTogglePinned={togglePinned}
        />
        <ComposerShell
          replyTarget={replyTarget}
          replyAuthor={replyAuthor}
          onCancelReply={() => setReplyTargetId(null)}
          onSend={sendMessage}
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
  onSelectReaction,
  onReply,
  onTogglePinned,
}: {
  conversation: Conversation;
  messages: ConversationMessage[];
  selectedReactions: Record<string, PostReaction | null>;
  highlightedMessageId: string | null;
  onSelectReaction: (messageId: string, reaction: PostReaction) => void;
  onReply: (message: ConversationMessage) => void;
  onTogglePinned: (message: ConversationMessage) => void;
}) {
  const participantById = new Map(
    conversation.participants.map((participant) => [
      participant.id,
      participant,
    ]),
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 md:px-5">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end gap-0.5">
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
            onClick={() => void navigator.clipboard.writeText(message.body)}
          >
            <CopyIcon aria-hidden />
            복사
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onTogglePinned}>
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
          {replyAction}
          {reactionAction}
        </>
      ) : (
        <>
          {reactionAction}
          {replyAction}
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
}: {
  replyTarget?: ConversationMessage;
  replyAuthor: string | null;
  onCancelReply: () => void;
  onSend: (body: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const composing = useRef(false);
  const normalizedDraft = normalizeMessageBody(draft);
  const hasDraft = normalizedDraft.trim() !== "";
  const draftLength = countMessageGraphemes(normalizedDraft);
  const overLimit = draftLength > MESSAGE_MAX_LENGTH;

  function sendDraft(): boolean {
    if (!hasDraft || overLimit) return false;
    onSend(normalizedDraft);
    setDraft("");
    return true;
  }

  return (
    <footer className="shrink-0 bg-background px-2 pt-2 pb-[calc(0.5rem+var(--app-safe-b))] md:px-3 md:pb-3">
      {replyTarget ? (
        <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 border-l-2 border-primary px-3 py-1">
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
      <div className="mx-auto flex max-w-3xl items-end gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="mb-0.5 rounded-full"
          aria-label="사진 첨부 기능 준비 중"
          disabled
        >
          <ImagePlusIcon aria-hidden className="size-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="mb-0.5 rounded-full"
          aria-label="파일 첨부 기능 준비 중"
          disabled
        >
          <FilePlus2Icon aria-hidden className="size-5" />
        </Button>
        <div className="flex min-h-10 min-w-0 flex-1 items-end gap-2 rounded-3xl bg-muted py-2 pr-3 pl-4">
          <textarea
            rows={1}
            value={draft}
            aria-label="메시지 입력"
            placeholder="메시지 입력"
            className="field-sizing-content max-h-32 min-h-6 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
            onChange={(event) => setDraft(event.currentTarget.value)}
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
          className="mx-auto mt-1 max-w-3xl px-3 text-xs text-destructive"
        >
          메시지는 {MESSAGE_MAX_LENGTH.toLocaleString("ko-KR")}자까지 쓸 수
          있습니다. ({draftLength.toLocaleString("ko-KR")})
        </p>
      ) : null}
    </footer>
  );
}
