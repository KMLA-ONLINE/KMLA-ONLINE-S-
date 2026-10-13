import { UsersIcon } from "lucide-react";

import type { ConversationSummary } from "~/features/messaging/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Avatar, AvatarFallback } from "~/shared/ui/avatar";
import { cn } from "~/shared/lib/utils";

export function ConversationAvatar({
  conversation,
  className,
  size = "default",
}: {
  conversation: Pick<
    ConversationSummary,
    "type" | "name" | "participants" | "viewerId"
  >;
  className?: string;
  size?: "default" | "lg";
}) {
  if (conversation.type === "direct") {
    const other = conversation.participants.find(
      ({ id }) => id !== conversation.viewerId,
    );
    return (
      <UserAvatar
        src={other?.avatarUrl}
        name={other?.name ?? conversation.name}
        className={cn(size === "lg" ? "size-20" : "size-12", className)}
      />
    );
  }

  // 나간 멤버도 이름을 그리려고 목록에 남지만 그룹 아바타는 지금 멤버로만 만든다.
  const others = conversation.participants
    .filter(({ id, active }) => active && id !== conversation.viewerId)
    .slice(0, 2);

  return (
    <div
      className={cn(
        size === "lg" ? "size-20" : "size-12",
        "relative shrink-0",
        className,
      )}
    >
      {others.map((participant, index) => (
        <UserAvatar
          key={participant.id}
          src={participant.avatarUrl}
          name={participant.name}
          // 다른 멤버가 한 명이면 1:1 대화 아바타와 같은 크기로 꽉 채운다.
          className={cn(
            "absolute",
            others.length === 1
              ? "inset-0 size-full"
              : cn(
                  "size-2/3 ring-2 ring-background",
                  index === 0 ? "top-0 right-0" : "bottom-0 left-0 z-10",
                ),
          )}
        />
      ))}
      {others.length === 0 ? (
        <Avatar className="size-full">
          <AvatarFallback>
            <UsersIcon aria-hidden />
          </AvatarFallback>
        </Avatar>
      ) : null}
    </div>
  );
}
