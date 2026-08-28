import {
  FilePlus2Icon,
  ChevronLeftIcon,
  ImagePlusIcon,
  InfoIcon,
  PinIcon,
  SearchIcon,
  SmileIcon,
  ThumbsUpIcon,
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
import { UserAvatar } from "~/shared/components/user-avatar";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import { cn } from "~/shared/lib/utils";

export function RoomScreen({ conversation }: { conversation: Conversation }) {
  const [desktopDetailsOpen, setDesktopDetailsOpen] = useState(true);
  const [compactDetailsOpen, setCompactDetailsOpen] = useState(false);
  const pinnedMessage = conversation.messages.find(({ pinned }) => pinned);

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
          <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-4 py-2">
            <PinIcon aria-hidden className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate text-xs">
              <strong className="mr-1 font-semibold">고정된 메시지</strong>
              {pinnedMessage.body}
            </span>
          </div>
        ) : null}

        <MessageThread conversation={conversation} />
        <ComposerShell />
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

function MessageThread({ conversation }: { conversation: Conversation }) {
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
                  <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
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
}: {
  message: ConversationMessage;
  sender?: MessageParticipant;
  isOwn: boolean;
  isGroup: boolean;
  startsGroup: boolean;
  endsGroup: boolean;
}) {
  return (
    <article
      aria-label={`${isOwn ? "내" : (sender?.name ?? "상대방")} 메시지`}
      className={cn(
        "flex items-end gap-2",
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
        {!isOwn && isGroup && startsGroup ? (
          <span className="mb-1 ml-2 text-xs text-muted-foreground">
            {sender?.name ?? "알 수 없는 사용자"}
          </span>
        ) : null}
        <div className="flex items-end gap-1.5">
          {isOwn && endsGroup ? <MessageMeta message={message} /> : null}
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
            </div>
            {message.reactions?.length ? (
              <Badge
                variant="secondary"
                className={cn(
                  "absolute -bottom-3 h-6 gap-1 rounded-full border border-background px-1.5 shadow-sm",
                  isOwn ? "right-1" : "left-1",
                )}
              >
                {message.reactions.map((reaction) => (
                  <span key={reaction.emoji}>
                    {reaction.emoji} {reaction.count}
                  </span>
                ))}
              </Badge>
            ) : null}
          </div>
          {!isOwn && endsGroup ? <MessageMeta message={message} /> : null}
        </div>
      </div>
    </article>
  );
}

function MessageMeta({ message }: { message: ConversationMessage }) {
  return (
    <span className="mb-0.5 flex shrink-0 flex-col items-end text-[11px] leading-4 text-muted-foreground">
      {message.readBy?.length ? (
        <span>읽음 {message.readBy.length}</span>
      ) : null}
      <span>{message.sentAt}</span>
    </span>
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

function ComposerShell() {
  return (
    <footer className="shrink-0 border-t bg-background px-2 pt-2 pb-[calc(0.5rem+var(--app-safe-b))] md:px-3 md:pb-3">
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
