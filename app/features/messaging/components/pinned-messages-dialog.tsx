import { LocateFixedIcon, PinOffIcon, XIcon } from "lucide-react";
import { useRef } from "react";

import {
  MessageActionRail,
  MessageRow,
} from "~/features/messaging/components/message-row";
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

function getPinnedMessages(messages: ConversationMessage[]) {
  const pinnedMessages: {
    message: ConversationMessage;
    dayLabel: string | undefined;
  }[] = [];
  let dayLabel: string | undefined;

  for (const message of messages) {
    dayLabel = message.dayLabel ?? dayLabel;
    if (message.pinned && !message.system) {
      pinnedMessages.push({ message, dayLabel });
    }
  }

  return pinnedMessages;
}

export function PinnedMessagesDialog({
  open,
  messages,
  participants,
  isGroup,
  onOpenChange,
  onViewMessage,
  onUnpin,
}: {
  open: boolean;
  messages: ConversationMessage[];
  participants: MessageParticipant[];
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
  const pinnedMessages = getPinnedMessages(messages);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[78svh] flex-col gap-0 overflow-hidden p-0 max-sm:top-0 max-sm:left-0 max-sm:h-svh max-sm:max-h-svh max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-2xl"
      >
        <DialogDescription className="sr-only">
          이 대화에서 고정한 메시지 목록
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
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2 sm:px-6"
        >
          {pinnedMessages.length ? (
            <div className="mx-auto flex max-w-3xl flex-col gap-0.5">
              {pinnedMessages.map(({ message, dayLabel }, index) => {
                const sender = message.senderId
                  ? participantById.get(message.senderId)
                  : undefined;
                const isOwn = message.senderId === "viewer";
                const previousDayLabel = pinnedMessages[index - 1]?.dayLabel;
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
                    aria-label="고정 취소"
                    onClick={() => onUnpin(message)}
                  >
                    <PinOffIcon aria-hidden />
                  </Button>
                );

                return (
                  <div key={message.id}>
                    {dayLabel && dayLabel !== previousDayLabel ? (
                      <div className="my-4 flex items-center justify-center">
                        <span className="text-xs text-muted-foreground">
                          {dayLabel}
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
                      contextViewportRef={messageViewportRef}
                      contextPortalRef={contextPortalRef}
                      contextActions={[
                        {
                          label: "채팅에서 보기",
                          icon: <LocateFixedIcon aria-hidden />,
                          onSelect: () => onViewMessage(message.id),
                        },
                        {
                          label: "고정 취소",
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
