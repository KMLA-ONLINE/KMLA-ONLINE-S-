import { AtSignIcon, BellOffIcon } from "lucide-react";

import { ConversationAvatar } from "~/features/messaging/components/conversation-avatar";
import { formatLastMessagePreview } from "~/features/messaging/model/conversation-preview";
import type { ConversationSummary } from "~/features/messaging/model/types";
import { RelativeTime } from "~/shared/components/relative-time";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";

/**
 * 대화 목록 한 줄의 틀. 메신저 목록은 대화방 링크로, 메시지 독은 미니 대화방을 여는 버튼으로 감싸므로
 * 겉모습만 여기서 나눠 쓴다.
 */
export const conversationRowClassName =
  "flex min-w-0 items-center gap-3 rounded-xl px-2 py-2.5 transition-colors outline-none select-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50";

/** 대화 목록 한 줄의 내용(기능 명세 §13.2): 아바타, 이름, 알림 단계, 마지막 메시지와 시각, 읽지 않은 수. */
export function ConversationRowContent({
  conversation,
  className,
}: {
  conversation: ConversationSummary;
  className?: string;
}) {
  return (
    <>
      <ConversationAvatar conversation={conversation} className={className} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="flex min-w-0 flex-1 items-center gap-1">
            <span className="min-w-0 truncate text-sm font-medium">
              {conversation.name}
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
              conversation.unreadCount > 0 && "font-medium text-foreground",
            )}
          >
            {formatLastMessagePreview(conversation, window.location.origin)}
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
    </>
  );
}
