import { UsersIcon } from "lucide-react";

import type { ConversationSummary } from "~/features/messaging/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Avatar, AvatarFallback, AvatarGroup } from "~/shared/ui/avatar";
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
    <AvatarGroup
      className={cn(
        size === "lg" ? "w-20" : "w-12",
        "justify-center",
        className,
      )}
    >
      {others.map((participant) => (
        <UserAvatar
          key={participant.id}
          src={participant.avatarUrl}
          name={participant.name}
          className={size === "lg" ? "size-14" : "size-9"}
        />
      ))}
      {others.length === 0 ? (
        <Avatar className={size === "lg" ? "size-20" : "size-12"}>
          <AvatarFallback>
            <UsersIcon aria-hidden />
          </AvatarFallback>
        </Avatar>
      ) : null}
    </AvatarGroup>
  );
}
