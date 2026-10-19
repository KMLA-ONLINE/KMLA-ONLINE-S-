import {
  AtSignIcon,
  BellOffIcon,
  MessageSquareMoreIcon,
  PenLineIcon,
  SearchIcon,
} from "lucide-react";
import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "react-router";

import { ConversationAvatar } from "~/features/messaging/components/conversation-avatar";
import { RecipientPickerDialog } from "~/features/messaging/components/recipient-picker-dialog";
import { useStartConversation } from "~/features/messaging/hooks/use-conversation-membership";
import { useRoomEntry } from "~/features/messaging/hooks/use-room-entry";
import {
  conversationDisplayName,
  conversationProfileName,
  formatLastMessagePreview,
} from "~/features/messaging/model/conversation-preview";
import type { ConversationSummary } from "~/features/messaging/model/types";
import { RelativeTime } from "~/shared/components/relative-time";
import { isHandheld } from "~/shared/lib/install-platform";
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
  const navigate = useNavigate();
  // 컴퓨터에서 메신저에 들어오면 빈 안내 대신 맨 위 대화를 연다. 그 대화에 읽지 않은 메시지가 있으면
  // 열지 않는다. 열면 읽음 위치가 갱신되어 보지 않은 메시지가 상대에게 읽음으로 보이고 내 안 읽음
  // 표시도 사라진다. 메신저 안에서 대화방을 나와 목록으로 온 것은 다시 열지 않도록 들어올 때 한 번만
  // 정한다. 고르는 동안에는 안내가 깜빡이지 않게 오른쪽을 비워 둔다.
  const [autoOpenRoomId, setAutoOpenRoomId] = useState(() => {
    if (hasRoom || isHandheld()) return undefined;
    if (!window.matchMedia("(min-width: 48rem)").matches) return undefined;
    const top = conversations.at(0);
    return top?.unreadCount === 0 ? top.id : undefined;
  });
  useEffect(() => {
    if (!autoOpenRoomId) return;
    // 기록을 쌓지 않아야 뒤로가기가 빈 목록을 거쳐 다시 대화방으로 튕기지 않는다.
    void Promise.resolve(
      navigate(`/messenger/${autoOpenRoomId}`, { replace: true }),
    ).finally(() => setAutoOpenRoomId(undefined));
  }, [autoOpenRoomId, navigate]);
  const deferredSearch = useDeferredValue(
    search.trim().toLocaleLowerCase("ko"),
  );
  const searchInput = useRef<HTMLInputElement>(null);
  const filteredConversations = deferredSearch
    ? conversations.filter((conversation) =>
        [
          conversationDisplayName(conversation),
          conversationProfileName(conversation),
        ].some((name) => name.toLocaleLowerCase("ko").includes(deferredSearch)),
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
        <header className="flex h-[calc(var(--app-page-header-h)+var(--app-safe-t))] shrink-0 items-center gap-2 px-4 pt-[var(--app-safe-t)] md:h-16 md:pt-0">
          <h1 className="min-w-0 flex-1 text-2xl font-bold">메시지</h1>
          <Button
            variant="secondary"
            size="icon"
            className="rounded-full"
            aria-label="새 채팅"
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

        <div className="relative mx-3 mb-2 shrink-0">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchInput}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="채팅 검색"
            aria-label="채팅 검색"
            className="rounded-full border-0 bg-muted pr-4 pl-9"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-x-desktop-auto overscroll-y-contain px-2 pb-2">
          {filteredConversations.length > 0 ? (
            <nav aria-label="채팅 목록" className="flex flex-col gap-0.5">
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
                            {conversationDisplayName(conversation)}
                          </span>
                          {conversation.notificationLevel === "off" ? (
                            <BellOffIcon
                              aria-label="알림 꺼짐"
                              className="size-3.5 shrink-0 text-muted-foreground"
                            />
                          ) : null}
                          {conversation.notificationLevel === "mentions" ? (
                            <AtSignIcon
                              aria-label="멘션만 알림"
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
                          {formatLastMessagePreview(
                            conversation,
                            window.location.origin,
                          )}
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
                    ? "채팅을 찾지 못했습니다"
                    : "아직 채팅이 없습니다"}
                </EmptyTitle>
                {deferredSearch ? (
                  <EmptyDescription>
                    다른 이름으로 다시 검색해 보세요.
                  </EmptyDescription>
                ) : null}
              </EmptyHeader>
              {deferredSearch ? null : (
                <Button
                  variant="secondary"
                  className="rounded-full"
                  onClick={() => setNewConversationOpen(true)}
                >
                  <PenLineIcon aria-hidden data-icon="inline-start" />새 채팅
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
        ) : autoOpenRoomId ? null : (
          <Empty className="h-full rounded-none border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="size-20 rounded-full">
                <MessageSquareMoreIcon aria-hidden className="size-10" />
              </EmptyMedia>
              <EmptyTitle>채팅을 골라 주세요</EmptyTitle>
              <EmptyDescription>
                왼쪽 목록에서 채팅을 고르거나 새 채팅을 시작하세요.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </>
  );
}
