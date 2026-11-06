import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";

import type { MessageParticipant } from "~/features/messaging/model/types";

/** 1:1 상대가 입력 중일 때 메시지 목록 맨 아래에 보이는 표시(기능 명세 §13.27). 대화방과 미니 대화방이 같이 쓴다. */
export function TypingIndicator({
  leaving,
  participant,
}: {
  leaving: boolean;
  participant?: MessageParticipant;
}) {
  return (
    <div
      role="status"
      className={cn(
        "mt-2 flex items-end gap-2 motion-reduce:animate-none",
        leaving
          ? "animate-typing-leave overflow-hidden"
          : "animate-in duration-200 fade-in slide-in-from-bottom-1",
      )}
    >
      <UserAvatar
        src={participant?.avatarUrl}
        name={participant?.name}
        className="size-7 shrink-0"
      />
      <span className="sr-only">{participant?.name ?? "상대"} 입력 중</span>
      <span
        aria-hidden
        className="flex h-[38px] items-center gap-[5px] rounded-2xl bg-muted px-3.5"
      >
        {["0ms", "180ms", "360ms"].map((delay) => (
          <span
            key={delay}
            className="size-[7px] animate-typing-dot rounded-full bg-muted-foreground motion-reduce:animate-none motion-reduce:opacity-60"
            style={{ animationDelay: delay }}
          />
        ))}
      </span>
    </div>
  );
}
