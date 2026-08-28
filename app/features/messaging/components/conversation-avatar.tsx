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
  conversation: Pick<ConversationSummary, "type" | "name" | "participants">;
  className?: string;
  size?: "default" | "lg";
}) {
  if (conversation.type === "direct") {
    const other = conversation.participants.find(({ id }) => id !== "viewer");
    return (
      <UserAvatar
        src={other?.avatarUrl}
        name={other?.name ?? conversation.name}
        className={cn(size === "lg" ? "size-20" : "size-12", className)}
      />
    );
  }

  const others = conversation.participants
    .filter(({ id }) => id !== "viewer")
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
          className={cn(
            "absolute size-2/3 ring-2 ring-background",
            others.length === 1
              ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
              : index === 0
                ? "top-0 right-0"
                : "bottom-0 left-0 z-10",
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
