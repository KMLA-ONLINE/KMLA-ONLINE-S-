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
  SmileIcon,
  ThumbsUpIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { ConversationAvatar } from "~/features/messaging/components/conversation-avatar";
import { ConversationDetails } from "~/features/messaging/components/conversation-details";
import type {
  Conversation,
  ConversationMessage,
  MessageParticipant,
} from "~/features/messaging/model/types";
import {
  QuickReactionBar,
  ReactionPickerSurface,
} from "~/features/posts/components/quick-reaction-bar";
import type { PostReaction } from "~/features/posts/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";
import { cn } from "~/shared/lib/utils";

const MESSAGE_REACTION_EMOJI = {
  like: "👍",
  love: "❤️",
  haha: "😆",
  wow: "😮",
  sad: "😢",
  angry: "😠",
} satisfies Record<PostReaction, string>;

export function RoomScreen({ conversation }: { conversation: Conversation }) {
  const [desktopDetailsOpen, setDesktopDetailsOpen] = useState(true);
  const [compactDetailsOpen, setCompactDetailsOpen] = useState(false);
  const [selectedReactions, setSelectedReactions] = useState<
    Record<string, PostReaction | null>
  >({});
  const [pinnedOverrides, setPinnedOverrides] = useState<
    Record<string, boolean>
  >({});
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const pinnedMessage = conversation.messages.find(
    (message) => pinnedOverrides[message.id] ?? message.pinned,
  );
  const pinnedMessageAuthor = pinnedMessage?.senderId
    ? (conversation.participants.find(({ id }) => id === pinnedMessage.senderId)
        ?.name ?? "알 수 없는 사용자")
    : null;
  const replyTarget = conversation.messages.find(
    ({ id }) => id === replyTargetId,
  );
  const replyAuthor = replyTarget?.senderId
    ? (conversation.participants.find(({ id }) => id === replyTarget.senderId)
        ?.name ?? "알 수 없는 사용자")
    : null;

  function selectReaction(messageId: string, reaction: PostReaction) {
    setSelectedReactions((current) => ({
      ...current,
      [messageId]: current[messageId] === reaction ? null : reaction,
    }));
  }

  function togglePinned(message: ConversationMessage) {
    setPinnedOverrides((current) => ({
      ...current,
      [message.id]: !(current[message.id] ?? message.pinned ?? false),
    }));
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
        <header className="flex h-[calc(var(--app-page-header-h)+var(--app-safe-t))] shrink-0 items-center gap-2 border-b bg-background/95 px-2 pt-[var(--app-safe-t)] backdrop-blur md:h-16 md:px-4 md:pt-0">
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
            <p className="truncate text-xs text-muted-foreground">
              {conversation.subtitle}
            </p>
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
          <div
            aria-label="고정 메시지"
            className="flex min-h-14 shrink-0 items-center gap-3 border-b bg-muted/40 px-4 py-2.5"
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
          </div>
        ) : null}

        <MessageThread
          conversation={conversation}
          selectedReactions={selectedReactions}
          pinnedOverrides={pinnedOverrides}
          onSelectReaction={selectReaction}
          onReply={(message) => setReplyTargetId(message.id)}
          onTogglePinned={togglePinned}
        />
        <ComposerShell
          replyTarget={replyTarget}
          replyAuthor={replyAuthor}
          onCancelReply={() => setReplyTargetId(null)}
        />
      </section>

      <ConversationDetails
        conversation={conversation}
        onMobileBack={() => setCompactDetailsOpen(false)}
        className={cn(
          compactDetailsOpen ? "flex xl:hidden" : "hidden",
          compactDetailsOpen &&
            "md:absolute md:inset-y-0 md:right-0 md:shadow-xl xl:static xl:shadow-none",
          desktopDetailsOpen ? "xl:flex" : "xl:hidden",
        )}
      />
    </div>
  );
}

function MessageThread({
  conversation,
  selectedReactions,
  pinnedOverrides,
  onSelectReaction,
  onReply,
  onTogglePinned,
}: {
  conversation: Conversation;
  selectedReactions: Record<string, PostReaction | null>;
  pinnedOverrides: Record<string, boolean>;
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
        {conversation.messages.map((message, index) => {
          const previous = conversation.messages[index - 1];
          const next = conversation.messages[index + 1];
          const startsGroup = message.system
            ? true
            : previous?.senderId !== message.senderId;
          const endsGroup = message.system
            ? true
            : next?.senderId !== message.senderId;
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
                  startsGroup={startsGroup}
                  endsGroup={endsGroup}
                  selectedReaction={selectedReactions[message.id]}
                  isPinned={
                    pinnedOverrides[message.id] ?? message.pinned ?? false
                  }
                  onSelectReaction={(reaction) =>
                    onSelectReaction(message.id, reaction)
                  }
                  onReply={() => onReply(message)}
                  onTogglePinned={() => onTogglePinned(message)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MessageRow({
  message,
  sender,
  isOwn,
  isGroup,
  startsGroup,
  endsGroup,
  selectedReaction,
  isPinned,
  onSelectReaction,
  onReply,
  onTogglePinned,
}: {
  message: ConversationMessage;
  sender?: MessageParticipant;
  isOwn: boolean;
  isGroup: boolean;
  startsGroup: boolean;
  endsGroup: boolean;
  selectedReaction?: PostReaction | null;
  isPinned: boolean;
  onSelectReaction: (reaction: PostReaction) => void;
  onReply: () => void;
  onTogglePinned: () => void;
}) {
  const reactions = new Map(
    message.reactions?.map(({ emoji, count }) => [emoji, count]) ?? [],
  );
  if (selectedReaction) {
    const emoji = MESSAGE_REACTION_EMOJI[selectedReaction];
    reactions.set(emoji, (reactions.get(emoji) ?? 0) + 1);
  }

  return (
    <article
      aria-label={`${isOwn ? "내" : (sender?.name ?? "상대방")} 메시지`}
      className={cn(
        "group/message flex items-end gap-2",
        isOwn ? "justify-end" : "justify-start",
        startsGroup && "mt-3",
      )}
    >
      {!isOwn ? (
        endsGroup ? (
          <UserAvatar
            src={sender?.avatarUrl}
            name={sender?.name}
            size="sm"
            className="mb-0.5"
          />
        ) : (
          <span className="w-6 shrink-0" aria-hidden />
        )
      ) : null}

      <div
        className={cn(
          "flex max-w-[78%] flex-col",
          isOwn ? "items-end" : "items-start",
        )}
      >
        {!isOwn && ((isGroup && startsGroup) || isPinned) ? (
          <span className="mb-1 ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{sender?.name ?? "알 수 없는 사용자"}</span>
            {isPinned ? <span>고정됨</span> : null}
          </span>
        ) : null}
        {isOwn && isPinned ? (
          <span className="mr-2 mb-1 text-xs text-muted-foreground">
            고정됨
          </span>
        ) : null}
        <div className="flex min-w-0 items-center gap-1.5">
          {isOwn ? (
            <MessageActions
              isOwn
              message={message}
              selectedReaction={selectedReaction}
              isPinned={isPinned}
              onSelectReaction={onSelectReaction}
              onReply={onReply}
              onTogglePinned={onTogglePinned}
            />
          ) : null}
          {isOwn && message.readBy?.length ? (
            <span
              aria-label={`${message.readBy.length}명 읽음`}
              className="mb-0.5 shrink-0 self-end text-[11px] leading-4 font-medium text-primary"
            >
              {message.readBy.length}
            </span>
          ) : null}
          <div className="relative">
            <div
              className={cn(
                "rounded-2xl px-3.5 py-2 text-sm break-words break-keep whitespace-pre-wrap",
                isOwn
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground",
                !startsGroup && isOwn && "rounded-tr-md",
                !startsGroup && !isOwn && "rounded-tl-md",
                !endsGroup && isOwn && "rounded-br-md",
                !endsGroup && !isOwn && "rounded-bl-md",
              )}
            >
              <MessageBody body={message.body} isOwn={isOwn} />
              <time
                className={cn(
                  "mt-1 block text-right text-[10px] leading-none",
                  isOwn
                    ? "text-primary-foreground/75"
                    : "text-muted-foreground",
                )}
              >
                {message.sentAt}
              </time>
            </div>
            {reactions.size ? (
              <Badge
                variant="secondary"
                className={cn(
                  "absolute -bottom-3 h-6 gap-1 rounded-full border border-background px-1.5 shadow-sm",
                  isOwn ? "right-1" : "left-1",
                )}
              >
                {[...reactions].map(([emoji, count]) => (
                  <span key={emoji}>
                    {emoji} {count}
                  </span>
                ))}
              </Badge>
            ) : null}
          </div>
          {!isOwn ? (
            <MessageActions
              isOwn={false}
              message={message}
              selectedReaction={selectedReaction}
              isPinned={isPinned}
              onSelectReaction={onSelectReaction}
              onReply={onReply}
              onTogglePinned={onTogglePinned}
            />
          ) : null}
        </div>
      </div>
    </article>
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

  return (
    <div className="relative flex shrink-0 items-center opacity-100 transition-opacity [@media(hover:hover)]:pointer-events-none [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/message:pointer-events-auto [@media(hover:hover)]:group-focus-within/message:opacity-100 [@media(hover:hover)]:group-hover/message:pointer-events-auto [@media(hover:hover)]:group-hover/message:opacity-100">
      {reactionOpen ? (
        <ReactionPickerSurface
          onDismiss={() => setReactionOpen(false)}
          className={cn("mb-2", !isOwn && "right-0 left-auto")}
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
      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-full text-muted-foreground"
        aria-label="메시지에 답장"
        onClick={onReply}
      >
        <ReplyIcon aria-hidden />
      </Button>
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
        <DropdownMenuContent side="top" align="center">
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
    </div>
  );
}

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

function MessageBody({ body, isOwn }: { body: string; isOwn: boolean }) {
  return body.split(URL_PATTERN).map((part, index) =>
    part.startsWith("http://") || part.startsWith("https://") ? (
      <a
        key={`${part}-${index}`}
        href={part}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "underline underline-offset-2",
          isOwn ? "text-primary-foreground" : "text-primary",
        )}
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}

function ComposerShell({
  replyTarget,
  replyAuthor,
  onCancelReply,
}: {
  replyTarget?: ConversationMessage;
  replyAuthor: string | null;
  onCancelReply: () => void;
}) {
  return (
    <footer className="shrink-0 border-t bg-background px-2 pt-2 pb-[calc(0.5rem+var(--app-safe-b))] md:px-3 md:pb-3">
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
          className="mb-0.5 hidden rounded-full sm:inline-flex"
          aria-label="파일 첨부 기능 준비 중"
          disabled
        >
          <FilePlus2Icon aria-hidden className="size-5" />
        </Button>
        <div
          aria-label="메시지 입력 기능 준비 중"
          className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-3xl bg-muted px-4 py-2 text-sm text-muted-foreground"
        >
          <span className="min-w-0 flex-1 truncate">메시지 입력</span>
          <SmileIcon aria-hidden className="size-5 shrink-0 text-primary" />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="mb-0.5 rounded-full text-primary"
          aria-label="좋아요 보내기 기능 준비 중"
          disabled
        >
          <ThumbsUpIcon aria-hidden className="size-5" />
        </Button>
      </div>
      <p className="sr-only">
        메시지 작성과 전송은 데이터 연동 단계에서 제공됩니다.
      </p>
    </footer>
  );
}
