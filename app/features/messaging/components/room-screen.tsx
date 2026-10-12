import {
  ChevronDownIcon,
  CopyIcon,
  EllipsisIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageIcon,
  InfoIcon,
  PaperclipIcon,
  PencilIcon,
  PinIcon,
  ReplyIcon,
  SearchIcon,
  SendIcon,
  SmileIcon,
  ThumbsUpIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  type Dispatch,
  memo,
  type RefObject,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
  useMemo,
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
import {
  useConversationMessages,
  type OlderMessagesResult,
} from "~/features/messaging/hooks/use-conversation-messages";
import { useConversationMute } from "~/features/messaging/hooks/use-conversation-mute";
import { canEditMessage } from "~/features/messaging/model/message-edit";
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
  MessageParticipant,
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
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
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
/** 맨 아래에서 이만큼 안이면 맨 아래를 보고 있는 것으로 보고, 새 메시지가 오면 따라 내려간다. */
const FOLLOW_NEW_MESSAGES_THRESHOLD = 80;
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
    pinnedMessages,
    hasOlderMessages,
    loadingOlderMessages,
    loadOlderMessages,
    send,
    draftIdFor,
    react,
    togglePinned,
    edit,
    remove,
  } = useConversationMessages(conversation);
  const { muted, toggleMuted } = useConversationMute(conversation);
  const [replyTarget, setReplyTarget] = useState<ConversationMessage | null>(
    null,
  );
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConversationMessage | null>(
    null,
  );
  const messageThreadRef = useRef<HTMLDivElement>(null);
  /** 방금 보낸 메시지. 그 메시지가 화면에 나타날 때 맨 아래로 내린다. */
  const sentMessageId = useRef<string | null>(null);
  const pinnedMessage = pinnedMessages.at(-1);
  const pinnedMessageAuthor = pinnedMessage?.senderId
    ? (conversation.participants.find(({ id }) => id === pinnedMessage.senderId)
        ?.name ?? "알 수 없는 사용자")
    : null;
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

  // 다음 변경이 아니라 보낸 메시지 자체를 기다린다. 앞선 페이지가 먼저 붙으면 그 변경에
  // 반응해 내려가고 정작 보낸 메시지가 나타날 때는 아무것도 하지 않게 된다.
  useEffect(() => {
    const id = sentMessageId.current;
    if (!id || !messages.some((message) => message.id === id)) return;
    const messageThread = messageThreadRef.current;
    if (messageThread) messageThread.scrollTop = messageThread.scrollHeight;
    sentMessageId.current = null;
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

  async function sendMessage(body: string) {
    const target = replyTarget;
    const id = draftIdFor(body, target?.id);
    sentMessageId.current = id;
    setReplyTarget(null);
    const sent = await send({
      id,
      body,
      replyTo: target
        ? {
            id: target.id,
            senderId: target.senderId,
            body: target.body,
            deleted: target.deleted,
          }
        : undefined,
    });
    // 작성창이 입력을 되살리므로 답장 대상도 함께 되살린다. 그새 다른 답장을 골랐으면 두지 않는다.
    if (!sent && target) setReplyTarget((current) => current ?? target);
    return sent;
  }

  // 고친 내용은 먼저 그린다. 실패하면 hook이 메시지를 되돌리고, 여기서는 고치던 입력과 함께
  // 수정 모드를 되살린다. 그새 다른 수정을 시작했으면 두지 않는다.
  async function submitEdit(body: string) {
    const target = editTarget?.message;
    if (!target) return;
    setEditTarget(null);
    if (body === target.body) return;
    const edited = await edit(target, body);
    if (!edited) {
      setEditTarget((current) => current ?? { message: target, draft: body });
    }
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
            if (message.deleted) return;
            setEditTarget(null);
            setReplyTarget(message);
          }}
          onTogglePinned={togglePinned}
          onEdit={(message) => {
            setReplyTarget(null);
            setEditTarget({ message, draft: message.body });
          }}
          onDelete={setDeleteTarget}
          onViewMessage={viewMessage}
        />
        <ComposerShell
          replyTarget={replyTarget ?? undefined}
          replyAuthor={replyAuthor}
          onCancelReply={() => setReplyTarget(null)}
          editTarget={editTarget ?? undefined}
          onCancelEdit={() => setEditTarget(null)}
          onEdit={submitEdit}
          onSend={sendMessage}
          desktopDetailsOpen={desktopDetailsOpen}
        />
      </section>

      <ConversationDetails
        conversation={conversation}
        onMobileBack={() => setCompactDetailsOpen(false)}
        pinnedCount={pinnedMessages.length}
        onOpenPinnedMessages={() => setPinnedDialogOpen(true)}
        muted={muted}
        onToggleMuted={toggleMuted}
        className={cn(
          compactDetailsOpen ? "flex xl:hidden" : "hidden",
          compactDetailsOpen &&
            "md:absolute md:inset-y-0 md:right-0 md:shadow-xl xl:static xl:shadow-none",
          desktopDetailsOpen ? "xl:flex" : "xl:hidden",
        )}
      />
      <PinnedMessagesDialog
        open={pinnedDialogOpen}
        messages={pinnedMessages}
        participants={conversation.participants}
        viewerId={conversation.viewerId}
        isGroup={conversation.type === "group"}
        onOpenChange={setPinnedDialogOpen}
        onViewMessage={viewMessage}
        onUnpin={togglePinned}
      />
      {deleteTarget ? (
        <ConfirmDialog
          title="메시지를 삭제할까요?"
          description="모든 참여자에게 '삭제된 메시지입니다'로 표시되고 반응과 고정도 사라집니다."
          confirmLabel="삭제"
          destructive
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            remove(deleteTarget);
            if (editTarget?.message.id === deleteTarget.id) setEditTarget(null);
            setDeleteTarget(null);
          }}
        />
      ) : null}
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
  onEdit,
  onDelete,
  onViewMessage,
}: {
  conversation: Conversation;
  messages: ConversationMessage[];
  highlightedMessageId: string | null;
  messageThreadRef: RefObject<HTMLDivElement | null>;
  desktopDetailsOpen: boolean;
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  onLoadOlderMessages: () => Promise<OlderMessagesResult>;
  onSelectReaction: (
    message: ConversationMessage,
    reaction: PostReaction,
  ) => void;
  onReply: (message: ConversationMessage) => void;
  onTogglePinned: (message: ConversationMessage) => void;
  onEdit: (message: ConversationMessage) => void;
  onDelete: (message: ConversationMessage) => void;
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
  // 앞선 페이지를 위에 붙이면 scrollHeight만 늘고 scrollTop은 그대로라 보던 메시지가 아래로
  // 밀린다. 붙이기 전 바닥에서의 거리와 그때의 맨 위 메시지를 기억했다가, 맨 위가 실제로 바뀐
  // 렌더에서만 같은 거리로 되돌린다. 읽기가 실패하거나 빈 페이지가 오면 버린다.
  const olderAnchor = useRef<{
    distanceFromBottom: number;
    oldestMessageId: string | undefined;
  } | null>(null);
  // 읽기가 실패한 뒤에는 맨 위 근처에서 스크롤할 때마다 다시 부르지 않는다. 사용자가 그 구간을
  // 벗어났다가 다시 올라오면 한 번 더 시도한다.
  const olderLoadFailed = useRef(false);
  const oldestMessageId = messages[0]?.id;
  const newestMessageId = messages.at(-1)?.id;
  // 맨 아래를 보고 있었는지. 새 메시지가 붙기 직전의 스크롤 위치로 판단해야 하므로 스크롤할 때 적어
  // 둔다. 붙은 뒤에 재면 새 메시지 높이만큼 이미 맨 아래에서 멀어져 있다.
  const followingNewMessages = useRef(true);
  // 부모가 렌더마다 새로 만드는 콜백을 그대로 넘기면 `ThreadMessage`의 memo가 매번 깨진다.
  // 행에는 한 번 만든 객체를 넘기고, 호출 시점에 최신 콜백을 읽는다.
  const latestHandlers = useRef({
    onSelectReaction,
    onReply,
    onTogglePinned,
    onEdit,
    onDelete,
    onViewMessage,
  });
  useLayoutEffect(() => {
    latestHandlers.current = {
      onSelectReaction,
      onReply,
      onTogglePinned,
      onEdit,
      onDelete,
      onViewMessage,
    };
  });
  const actions = useMemo<ThreadMessageActions>(
    () => ({
      selectReaction: (message, reaction) =>
        latestHandlers.current.onSelectReaction(message, reaction),
      reply: (message) => latestHandlers.current.onReply(message),
      togglePinned: (message) => latestHandlers.current.onTogglePinned(message),
      edit: (message) => latestHandlers.current.onEdit(message),
      delete: (message) => latestHandlers.current.onDelete(message),
      viewMessage: (messageId) =>
        latestHandlers.current.onViewMessage(messageId),
    }),
    [],
  );

  useLayoutEffect(() => {
    const messageThread = messageThreadRef.current;
    const anchor = olderAnchor.current;
    if (!messageThread || !anchor) return;
    if (anchor.oldestMessageId === oldestMessageId) return;
    messageThread.scrollTop =
      messageThread.scrollHeight - anchor.distanceFromBottom;
    olderAnchor.current = null;
  }, [oldestMessageId, messageThreadRef]);

  // 맨 아래를 보고 있을 때 새 메시지가 붙으면 따라 내려간다. 위로 올려 지난 대화를 보던 중이면
  // 그대로 두고 맨 아래 이동 버튼으로 알린다. 앞선 페이지가 위에 붙을 때는 가장 최근 메시지가
  // 바뀌지 않으므로 여기에 걸리지 않는다.
  useLayoutEffect(() => {
    const messageThread = messageThreadRef.current;
    if (!messageThread || !followingNewMessages.current) return;
    messageThread.scrollTop = messageThread.scrollHeight;
  }, [newestMessageId, messageThreadRef]);

  function maybeLoadOlderMessages() {
    const messageThread = messageThreadRef.current;
    if (!messageThread) return;
    if (messageThread.scrollTop > OLDER_MESSAGES_THRESHOLD) {
      olderLoadFailed.current = false;
      return;
    }
    if (!hasOlderMessages || loadingOlderMessages || olderLoadFailed.current)
      return;

    const anchor = {
      distanceFromBottom: messageThread.scrollHeight - messageThread.scrollTop,
      oldestMessageId,
    };
    olderAnchor.current = anchor;
    void onLoadOlderMessages().then((result) => {
      if (result === "failed") olderLoadFailed.current = true;
      // 붙인 메시지가 없으면 맨 위가 바뀌지 않아 layout effect가 거두지 않으므로 여기서 버린다.
      if (result !== "loaded" && olderAnchor.current === anchor) {
        olderAnchor.current = null;
      }
    });
  }

  function updateScrollToBottomVisibility() {
    const messageThread = messageThreadRef.current;
    if (!messageThread) return;
    const distanceFromBottom =
      messageThread.scrollHeight -
      messageThread.clientHeight -
      messageThread.scrollTop;
    followingNewMessages.current =
      distanceFromBottom <= FOLLOW_NEW_MESSAGES_THRESHOLD;

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
            const replyTargetAuthor = message.replyTo?.senderId
              ? participantById.get(message.replyTo.senderId)?.name
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
                  <ThreadMessage
                    message={message}
                    sender={sender}
                    replyTargetAuthor={replyTargetAuthor}
                    isOwn={message.senderId === conversation.viewerId}
                    canEdit={canEditMessage(message, conversation.viewerId)}
                    isGroup={conversation.type === "group"}
                    startsGroup={startsGroup}
                    endsGroup={endsGroup}
                    highlighted={highlightedMessageId === message.id}
                    contextViewportRef={messageThreadRef}
                    contextPortalRef={contextPortalRef}
                    actions={actions}
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

/** 고치는 중인 내 메시지와 작성창에 올릴 입력. 실패한 수정을 되살릴 때는 입력이 원문과 다르다. */
interface EditTarget {
  message: ConversationMessage;
  draft: string;
}

interface ThreadMessageActions {
  selectReaction: (
    message: ConversationMessage,
    reaction: PostReaction,
  ) => void;
  reply: (message: ConversationMessage) => void;
  togglePinned: (message: ConversationMessage) => void;
  edit: (message: ConversationMessage) => void;
  delete: (message: ConversationMessage) => void;
  viewMessage: (messageId: string) => void;
}

/**
 * 메시지 한 건. 긴 대화방에서 스크롤, 강조, 반응 하나가 바뀔 때마다 모든 행이 다시 그려지지 않도록
 * memo로 감싼다. 넘기는 값은 모두 원시값이거나 그대로 유지되는 참조여야 한다. `message`는 cache가
 * 바뀐 메시지만 새 객체로 바꾸고, `sender`는 대화의 참여자 객체, `actions`는 한 번 만든 객체다.
 */
const ThreadMessage = memo(function ThreadMessage({
  message,
  sender,
  replyTargetAuthor,
  isOwn,
  canEdit,
  isGroup,
  startsGroup,
  endsGroup,
  highlighted,
  contextViewportRef,
  contextPortalRef,
  actions,
}: {
  message: ConversationMessage;
  sender?: MessageParticipant;
  replyTargetAuthor?: string;
  isOwn: boolean;
  /** 15분 기한은 렌더 시점에 판정한다. 기한이 지나면 다음 렌더에서 메뉴가 빠지고, 서버가 최종 판정한다. */
  canEdit: boolean;
  isGroup: boolean;
  startsGroup: boolean;
  endsGroup: boolean;
  highlighted: boolean;
  contextViewportRef: RefObject<HTMLDivElement | null>;
  contextPortalRef: RefObject<HTMLDivElement | null>;
  actions: ThreadMessageActions;
}) {
  const replyTarget = message.replyTo;
  // 삭제된 메시지는 반응, 고정, 수정, 삭제를 받지 않는다. 전송 중인 메시지는 아직 서버에 없어
  // 복사만 된다. 남는 작업이 없으면 메뉴를 열지 않는다.
  const actionable = !message.deleted && !message.pending;
  const contextActions = [
    ...(actionable
      ? [
          {
            label: "답장",
            icon: <ReplyIcon aria-hidden />,
            onSelect: () => actions.reply(message),
          },
        ]
      : []),
    ...(message.deleted
      ? []
      : [
          {
            label: "복사",
            icon: <CopyIcon aria-hidden />,
            onSelect: () => void copyMessageText(message.body),
          },
        ]),
    ...(actionable
      ? [
          {
            label: message.pinned ? "고정 해제" : "고정",
            icon: <PinIcon aria-hidden />,
            onSelect: () => actions.togglePinned(message),
          },
        ]
      : []),
    ...(canEdit
      ? [
          {
            label: "수정",
            icon: <PencilIcon aria-hidden />,
            onSelect: () => actions.edit(message),
          },
        ]
      : []),
    ...(isOwn && actionable
      ? [
          {
            label: "삭제",
            icon: <Trash2Icon aria-hidden />,
            onSelect: () => actions.delete(message),
          },
        ]
      : []),
  ];

  return (
    <MessageRow
      message={message}
      sender={sender}
      isOwn={isOwn}
      isGroup={isGroup}
      unreadParticipantCount={message.unreadMemberCount ?? 0}
      startsGroup={startsGroup}
      endsGroup={endsGroup}
      isPinned={message.pinned ?? false}
      highlighted={highlighted}
      elementId={`message-${message.id}`}
      contextViewportRef={contextViewportRef}
      contextPortalRef={contextPortalRef}
      replyTarget={replyTarget}
      replyTargetAuthor={replyTargetAuthor}
      onViewReply={
        replyTarget ? () => actions.viewMessage(replyTarget.id) : undefined
      }
      onReply={actionable ? () => actions.reply(message) : undefined}
      onSelectReaction={
        actionable
          ? (reaction) => actions.selectReaction(message, reaction)
          : undefined
      }
      contextActions={contextActions.length ? contextActions : undefined}
      actionRail={
        <MessageActions
          isOwn={isOwn}
          message={message}
          isPinned={message.pinned ?? false}
          onSelectReaction={(reaction) =>
            actions.selectReaction(message, reaction)
          }
          onReply={() => actions.reply(message)}
          onTogglePinned={() => actions.togglePinned(message)}
          onEdit={canEdit ? () => actions.edit(message) : undefined}
          onDelete={
            isOwn && actionable ? () => actions.delete(message) : undefined
          }
        />
      }
    />
  );
});

function MessageActions({
  isOwn,
  message,
  isPinned,
  onSelectReaction,
  onReply,
  onTogglePinned,
  onEdit,
  onDelete,
}: {
  isOwn: boolean;
  message: ConversationMessage;
  isPinned: boolean;
  onSelectReaction: (reaction: PostReaction) => void;
  onReply: () => void;
  onTogglePinned: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
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
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => void copyMessageText(message.body)}
          >
            <CopyIcon aria-hidden />
            복사
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer" onClick={onTogglePinned}>
            <PinIcon aria-hidden />
            {isPinned ? "고정 해제" : "고정"}
          </DropdownMenuItem>
          {onEdit ? (
            <DropdownMenuItem className="cursor-pointer" onClick={onEdit}>
              <PencilIcon aria-hidden />
              수정
            </DropdownMenuItem>
          ) : null}
          {onDelete ? (
            <DropdownMenuItem
              className="cursor-pointer"
              variant="destructive"
              onClick={onDelete}
            >
              <Trash2Icon aria-hidden />
              삭제
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // 삭제된 메시지에는 할 수 있는 작업이 없고, 전송 중인 메시지는 아직 서버에 없다.
  if (message.deleted || message.pending) return null;

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
  editTarget,
  onCancelEdit,
  onEdit,
  onSend,
  desktopDetailsOpen,
}: {
  replyTarget?: ConversationMessage;
  replyAuthor: string | null;
  onCancelReply: () => void;
  /** 고치는 중인 내 메시지. 작성창이 그 입력으로 바뀌고, 보내면 `onEdit`을 부른다. */
  editTarget?: EditTarget;
  onCancelEdit: () => void;
  onEdit: (body: string) => Promise<void>;
  /** 실패하면 false로 끝난다. 작성창은 비워 둔 입력을 되살린다. */
  onSend: (body: string) => Promise<boolean>;
  desktopDetailsOpen: boolean;
}) {
  const [draft, setDraft] = useState("");
  // 고치기를 시작하면 쓰던 입력을 맡겨 두고 메시지 본문을 올린다. 끝나면 맡긴 입력을 되돌린다.
  const [editingId, setEditingId] = useState<string | undefined>();
  const [heldDraft, setHeldDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  if (editTarget?.message.id !== editingId) {
    setEditingId(editTarget?.message.id);
    if (editTarget) {
      if (editingId === undefined) setHeldDraft(draft);
      setDraft(editTarget.draft);
    } else {
      setDraft(heldDraft);
      setHeldDraft("");
    }
  }
  useEffect(() => {
    if (editingId) textareaRef.current?.focus();
  }, [editingId]);
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
    if (editTarget) {
      void onEdit(body);
      return true;
    }
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
      {editTarget ? (
        <div
          className={cn(
            "mx-auto mb-2 flex max-w-3xl items-center gap-2 border-l-2 border-primary px-3 py-1",
            !desktopDetailsOpen && "xl:max-w-none",
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-primary">메시지 수정</p>
            <p className="truncate text-xs text-muted-foreground">
              {editTarget.message.body}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            className="rounded-full"
            aria-label="수정 취소"
            onClick={onCancelEdit}
          >
            <XIcon aria-hidden />
          </Button>
        </div>
      ) : null}
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
            ref={textareaRef}
            rows={1}
            value={draft}
            aria-label="메시지 입력"
            placeholder="메시지 입력"
            className="field-sizing-content max-h-32 min-h-6 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
            onChange={(event) => changeDraft(event.currentTarget.value)}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => (composing.current = false)}
            onKeyDown={(event) => {
              const composingText =
                composing.current ||
                event.nativeEvent.isComposing ||
                event.keyCode === 229;
              // 조합 중 Esc는 IME가 조합을 취소하는 키다. 수정을 취소하지 않는다.
              if (event.key === "Escape" && editTarget && !composingText) {
                event.preventDefault();
                onCancelEdit();
                return;
              }
              if (event.key !== "Enter" || event.shiftKey) return;
              // Safari는 compositionend를 Enter keydown보다 먼저 보내 isComposing도 false다.
              // 그 keydown은 keyCode 229로 온다.
              if (composingText) return;
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
          aria-label={
            editTarget
              ? "수정한 메시지 저장"
              : hasDraft
                ? "메시지 보내기"
                : "좋아요 보내기"
          }
          disabled={overLimit || (editTarget !== undefined && !hasDraft)}
          onClick={() => {
            if (hasDraft || editTarget) {
              sendDraft();
              return;
            }
            void onSend("👍");
            // 공백만 있던 입력은 좋아요와 함께 비운다.
            setDraft("");
          }}
        >
          {hasDraft || editTarget ? (
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
