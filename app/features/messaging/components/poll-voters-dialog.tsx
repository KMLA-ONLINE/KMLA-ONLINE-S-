import type {
  MessageParticipant,
  MessagePoll,
} from "~/features/messaging/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";

/** 투표에서 누가 어디를 골랐는지(기능 명세 §13.30). 선택지마다 고른 사람을 이름과 사진으로 보여 준다. */
export function PollVotersDialog({
  open,
  onOpenChange,
  question,
  poll,
  participants,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question: string;
  poll: MessagePoll | null;
  participants: ReadonlyMap<string, MessageParticipant>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80svh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>투표 결과</DialogTitle>
          <DialogDescription className="break-words">
            {question}
          </DialogDescription>
        </DialogHeader>
        {poll ? (
          <ul className="flex flex-col gap-4">
            {poll.options.map((option) => (
              <li key={option.id} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 font-medium break-words">
                    {option.label}
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {option.count}명
                  </span>
                </div>
                {option.voterIds.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {option.voterIds.map((id) => {
                      const voter = participants.get(id);
                      return (
                        <li
                          key={id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <UserAvatar
                            src={voter?.avatarUrl}
                            name={voter?.name}
                            className="size-6"
                          />
                          <span className="min-w-0 truncate">
                            {voter?.name ?? "알 수 없는 사용자"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    아직 아무도 고르지 않았습니다.
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
