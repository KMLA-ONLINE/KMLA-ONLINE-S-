import {
  BellOffIcon,
  MessageSquareMoreIcon,
  PenLineIcon,
  SearchIcon,
} from "lucide-react";
import { useDeferredValue, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { ConversationAvatar } from "~/features/messaging/components/conversation-avatar";
import { RecipientPickerDialog } from "~/features/messaging/components/recipient-picker-dialog";
import { useStartConversation } from "~/features/messaging/hooks/use-conversation-membership";
import { useRoomEntry } from "~/features/messaging/hooks/use-room-entry";
import { formatLastMessagePreview } from "~/features/messaging/model/conversation-preview";
import type { ConversationSummary } from "~/features/messaging/model/types";
import { RelativeTime } from "~/shared/components/relative-time";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/shared/ui/empty";
import { Input } from "~/shared/ui/input";

export function MessagingScreen({
  children,
  hasRoom,
  conversations,
  selectedRoomId,
}: {
  children: ReactNode;
  hasRoom: boolean;
  conversations: ConversationSummary[];
  selectedRoomId?: string;
}) {
  const [search, setSearch] = useState("");
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const roomEntry = useRoomEntry(hasRoom);
  const startConversation = useStartConversation(roomEntry);
  const deferredSearch = useDeferredValue(
    search.trim().toLocaleLowerCase("ko"),
  );
  const searchInput = useRef<HTMLInputElement>(null);
  const filteredConversations = deferredSearch
    ? conversations.filter(({ name }) =>
        name.toLocaleLowerCase("ko").includes(deferredSearch),
      )
    : conversations;

  return (
    <>
      <div
        className={cn(
          "flex w-full min-w-0 flex-col border-r bg-background md:w-80 md:shrink-0",
          hasRoom && "max-md:hidden",
        )}
      >
        <header className="flex h-[calc(var(--app-page-header-h)+var(--app-safe-t))] shrink-0 items-center gap-2 px-4 pt-[var(--app-safe-t)] md:h-16 md:border-b md:pt-0">
          <h1 className="min-w-0 flex-1 text-2xl font-bold">메시지</h1>
          <Button
            variant="secondary"
            size="icon"
            className="rounded-full"
            aria-label="새 대화"
            onClick={() => setNewConversationOpen(true)}
          >
            <PenLineIcon aria-hidden />
          </Button>
          <RecipientPickerDialog
            open={newConversationOpen}
            mode="create"
            onOpenChange={setNewConversationOpen}
            onSubmit={async (selection) => {
              await startConversation(selection);
              setNewConversationOpen(false);
            }}
          />
        </header>

        <div className="relative mx-3 mb-2 shrink-0 md:mt-3">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchInput}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="대화 검색"
            aria-label="대화 검색"
            className="rounded-full border-0 bg-muted pr-4 pl-9"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
          {filteredConversations.length > 0 ? (
            <nav aria-label="대화 목록" className="flex flex-col gap-0.5">
              {filteredConversations.map((conversation) => {
                const selected = conversation.id === selectedRoomId;
                return (
                  <Link
                    key={conversation.id}
                    to={`/messenger/${conversation.id}`}
                    replace={roomEntry.replace}
                    state={roomEntry.state}
                    aria-current={selected ? "page" : undefined}
                    className={cn(
                      "flex min-w-0 items-center gap-3 rounded-xl px-2 py-2.5 transition-colors outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50",
                      selected && "bg-primary/10 hover:bg-primary/10",
                    )}
                  >
                    <ConversationAvatar conversation={conversation} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="flex min-w-0 flex-1 items-center gap-1">
                          <span className="min-w-0 truncate text-sm font-medium">
                            {conversation.name}
                          </span>
                          {conversation.muted ? (
                            <BellOffIcon
                              aria-label="알림 꺼짐"
                              className="size-3.5 shrink-0 text-muted-foreground"
                            />
                          ) : null}
                        </span>
                        {conversation.lastMessage ? (
                          <RelativeTime
                            value={conversation.lastMessage.sentAt}
                            className="shrink-0 text-xs text-muted-foreground"
                          />
                        ) : null}
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-sm text-muted-foreground",
                            conversation.unreadCount > 0 &&
                              "font-medium text-foreground",
                          )}
                        >
                          {formatLastMessagePreview(conversation)}
                        </span>
                        {conversation.unreadCount > 0 ? (
                          <Badge
                            className="min-w-5 px-1.5"
                            aria-label={`읽지 않은 메시지 ${conversation.unreadCount}개`}
                          >
                            {conversation.unreadCount}
                          </Badge>
                        ) : null}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </nav>
          ) : (
            <Empty className="h-full border-0 px-4">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  {deferredSearch ? (
                    <SearchIcon aria-hidden />
                  ) : (
                    <MessageSquareMoreIcon aria-hidden />
                  )}
                </EmptyMedia>
                <EmptyTitle>
                  {deferredSearch
                    ? "대화를 찾지 못했습니다"
                    : "아직 대화가 없습니다"}
                </EmptyTitle>
                <EmptyDescription>
                  {deferredSearch
                    ? "다른 이름으로 다시 검색해 보세요."
                    : "새 대화 버튼으로 대화를 시작해 보세요."}
                </EmptyDescription>
              </EmptyHeader>
              {/* 넓은 화면에서는 오른쪽 빈 화면에 같은 버튼이 있다. */}
              {deferredSearch ? null : (
                <Button
                  variant="secondary"
                  className="rounded-full md:hidden"
                  onClick={() => setNewConversationOpen(true)}
                >
                  <PenLineIcon aria-hidden data-icon="inline-start" />새 대화
                  시작하기
                </Button>
              )}
            </Empty>
          )}
        </div>
      </div>

      <div
        className={cn(
          "min-w-0 flex-1 flex-col",
          hasRoom ? "flex" : "hidden md:flex",
        )}
      >
        {hasRoom ? (
          children
        ) : (
          <Empty className="h-full rounded-none border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="size-20 rounded-full">
                <MessageSquareMoreIcon aria-hidden className="size-10" />
              </EmptyMedia>
              <EmptyTitle>대화를 골라 주세요</EmptyTitle>
              <EmptyDescription>
                왼쪽 목록에서 대화를 고르거나 새 대화를 시작하세요.
              </EmptyDescription>
            </EmptyHeader>
            <Button
              variant="secondary"
              className="rounded-full"
              onClick={() => setNewConversationOpen(true)}
            >
              <PenLineIcon aria-hidden data-icon="inline-start" />새 대화
              시작하기
            </Button>
          </Empty>
        )}
      </div>
    </>
  );
}
