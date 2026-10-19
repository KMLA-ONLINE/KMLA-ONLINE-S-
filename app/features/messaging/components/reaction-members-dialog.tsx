import { useQuery } from "@tanstack/react-query";

import { messagingKeys } from "~/features/messaging/data/cache";
import { listMessageReactors } from "~/features/messaging/data/queries";
import type { ConversationMessage } from "~/features/messaging/model/types";
import { ReactionEmoji } from "~/features/posts/components/reaction/reaction-emoji";
import { UserAvatar } from "~/shared/components/user-avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Spinner } from "~/shared/ui/spinner";

/** 메시지에 반응한 사람(기능 명세 §13.8). 열 때마다 서버에서 새로 읽는다. */
export function ReactionMembersDialog({
  message,
  onClose,
}: {
  message: ConversationMessage;
  onClose: () => void;
}) {
  const reactors = useQuery({
    queryKey: messagingKeys.reactors(message.id),
    queryFn: () => listMessageReactors(message.id),
    staleTime: 0,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[min(32rem,85dvh)] flex-col sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>반응</DialogTitle>
          <DialogDescription className="sr-only">
            이 메시지에 반응한 사람
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-24 flex-1 overflow-y-auto overscroll-x-desktop-auto overscroll-y-contain">
          {reactors.isPending ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : reactors.isError ? (
            <p
              role="alert"
              className="py-6 text-center text-sm text-destructive"
            >
              반응을 불러오지 못했습니다.
            </p>
          ) : reactors.data.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              아직 반응이 없습니다.
            </p>
          ) : (
            <ul aria-label="반응한 사람" className="flex flex-col gap-1">
              {reactors.data.map((reactor) => (
                <li
                  key={reactor.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2"
                >
                  <UserAvatar
                    src={reactor.avatarUrl}
                    name={reactor.name}
                    size="lg"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {reactor.name}
                  </span>
                  <ReactionEmoji
                    reaction={reactor.reaction}
                    labelled
                    className="size-5"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
