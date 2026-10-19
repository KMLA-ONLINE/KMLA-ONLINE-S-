import { LocateFixedIcon, PinOffIcon, XIcon } from "lucide-react";
import { useRef } from "react";

import {
  MessageActionRail,
  MessageRow,
} from "~/features/messaging/components/message-row";
import {
  formatMessageDay,
  startsMessageDay,
} from "~/features/messaging/model/message-time";
import type {
  ConversationMessage,
  MessageParticipant,
} from "~/features/messaging/model/types";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "~/shared/ui/dialog";

export function PinnedMessagesDialog({
  open,
  messages,
  participants,
  viewerId,
  isGroup,
  onOpenChange,
  onViewMessage,
  onUnpin,
}: {
  open: boolean;
  messages: ConversationMessage[];
  participants: MessageParticipant[];
  viewerId: string;
  isGroup: boolean;
  onOpenChange: (open: boolean) => void;
  onViewMessage: (messageId: string) => void;
  onUnpin: (message: ConversationMessage) => void;
}) {
  const messageViewportRef = useRef<HTMLDivElement>(null);
  const contextPortalRef = useRef<HTMLDivElement>(null);
  const participantById = new Map(
    participants.map((participant) => [participant.id, participant]),
  );
  const pinnedMessages = messages.filter(
    (message) => message.pinned && !message.system,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[78svh] flex-col gap-0 overflow-hidden p-0 max-sm:top-0 max-sm:left-0 max-sm:h-svh max-sm:max-h-svh max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-2xl"
      >
        <DialogDescription className="sr-only">
          이 채팅에서 고정한 메시지 목록
        </DialogDescription>
        <header className="flex h-16 shrink-0 items-center border-b px-4">
          <DialogTitle className="min-w-0 flex-1 text-center text-xl font-semibold">
            고정된 메시지
          </DialogTitle>
          <Button
            variant="secondary"
            size="icon"
            className="absolute right-3 rounded-full"
            aria-label="고정된 메시지 닫기"
            onClick={() => onOpenChange(false)}
          >
            <XIcon />
          </Button>
        </header>

        <div
          ref={messageViewportRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-x-desktop-auto overscroll-y-contain px-4 py-2 sm:px-6"
        >
          {pinnedMessages.length ? (
            <div className="mx-auto flex max-w-3xl flex-col gap-0.5">
              {pinnedMessages.map((message, index) => {
                const sender = message.senderId
                  ? participantById.get(message.senderId)
                  : undefined;
                const isOwn = message.senderId === viewerId;
                const viewAction = (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-full text-muted-foreground"
                    aria-label="채팅에서 보기"
                    onClick={() => onViewMessage(message.id)}
                  >
                    <LocateFixedIcon aria-hidden />
                  </Button>
                );
                const unpinAction = (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-full text-muted-foreground"
                    aria-label="고정 해제"
                    onClick={() => onUnpin(message)}
                  >
                    <PinOffIcon aria-hidden />
                  </Button>
                );

                return (
                  // 메시지를 누르면 원래 메시지로 간다. 모바일에서 길게 누르지 않아도 된다. 작업 버튼,
                  // 본문 링크와 오디오는 각자 자기 일을 한다. 키보드는 `대화에서 보기` 버튼을 쓴다.
                  // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                  <div
                    key={message.id}
                    className="cursor-pointer"
                    onClick={(event) => {
                      if (
                        event.target instanceof Element &&
                        event.target.closest("button, a, audio")
                      ) {
                        return;
                      }
                      onViewMessage(message.id);
                    }}
                  >
                    {startsMessageDay(pinnedMessages[index - 1], message) ? (
                      <div className="my-4 flex items-center justify-center">
                        <span className="text-xs text-muted-foreground">
                          {formatMessageDay(message.sentAt)}
                        </span>
                      </div>
                    ) : null}
                    <MessageRow
                      message={message}
                      sender={sender}
                      isOwn={isOwn}
                      isGroup={isGroup}
                      isPinned
                      showPinnedLabel={false}
                      showUnreadCount={false}
                      showReactions={false}
                      showTimestamp
                      contextViewportRef={messageViewportRef}
                      contextPortalRef={contextPortalRef}
                      contextActions={[
                        {
                          label: "채팅에서 보기",
                          icon: <LocateFixedIcon aria-hidden />,
                          onSelect: () => onViewMessage(message.id),
                        },
                        {
                          label: "고정 해제",
                          icon: <PinOffIcon aria-hidden />,
                          onSelect: () => onUnpin(message),
                        },
                      ]}
                      actionRail={
                        <MessageActionRail>
                          {isOwn ? (
                            <>
                              {unpinAction}
                              {viewAction}
                            </>
                          ) : (
                            <>
                              {viewAction}
                              {unpinAction}
                            </>
                          )}
                        </MessageActionRail>
                      }
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">
              고정된 메시지가 없습니다
            </p>
          )}
        </div>
        <div
          ref={contextPortalRef}
          data-slot="message-context-portal"
          className="contents"
        />
      </DialogContent>
    </Dialog>
  );
}
