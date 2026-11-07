import { CheckIcon, LockIcon } from "lucide-react";

import {
  nextPollChoice,
  pollVoterCount,
} from "~/features/messaging/model/poll";
import type { MessagePoll } from "~/features/messaging/model/types";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";

/**
 * 메시지 버블 안의 투표 카드(기능 명세 §13.30). 선택지를 누르면 바로 투표하거나 취소하고, 작성자는
 * 종료할 수 있다. 종료된 투표는 결과만 보인다.
 */
export function MessagePollCard({
  question,
  poll,
  isOwn,
  canVote,
  onVote,
  onClose,
  onShowVoters,
}: {
  question: string;
  poll: MessagePoll;
  isOwn: boolean;
  /** 입력창이 있는 대화의 현재 멤버인지. 아니면 결과만 본다. */
  canVote: boolean;
  onVote: (optionIds: string[]) => void;
  /** 작성자만 받는다. 없으면 종료 버튼을 두지 않는다. */
  onClose?: () => void;
  /** 있으면 참여 수가 고른 사람 목록을 여는 버튼이 된다. */
  onShowVoters?: () => void;
}) {
  const closed = poll.closedAt !== null;
  const votable = canVote && !closed;
  const voters = pollVoterCount(poll);
  const mine = new Set(poll.myOptionIds);
  const maxCount = Math.max(1, ...poll.options.map(({ count }) => count));

  return (
    // 폭은 대화 영역(`@container`) 비율로 잡는다. 고정 폭이면 작은 방과 좁은 화면에서 버블 폭 제한을
    // 넘어 가로 스크롤이 생기고, 백분율 최대 폭은 버블이 내용에 맞춰 줄어드는 사슬이라 카드를 글자
    // 폭까지 오그라뜨린다.
    <div
      className={cn(
        "flex w-[min(18rem,62cqi)] flex-col gap-2 text-sm",
        isOwn ? "text-action-foreground" : "text-foreground",
      )}
    >
      <div className="flex flex-col gap-0.5">
        <p className="font-semibold break-words">{question}</p>
        <p
          className={cn(
            "text-xs",
            isOwn ? "opacity-80" : "text-muted-foreground",
          )}
        >
          {closed
            ? "투표 종료됨"
            : poll.multiple
              ? "복수 선택 가능"
              : "하나만 고를 수 있어요"}
        </p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {poll.options.map((option) => {
          const chosen = mine.has(option.id);
          const ratio = option.count / maxCount;
          return (
            <li key={option.id}>
              <button
                type="button"
                aria-pressed={chosen}
                disabled={!votable}
                onClick={() => onVote(nextPollChoice(poll, option.id))}
                className={cn(
                  "relative flex w-full items-center gap-2 overflow-hidden rounded-lg px-2.5 py-1.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default",
                  isOwn
                    ? "bg-action-foreground/10 hover:enabled:bg-action-foreground/20"
                    : "bg-card ring-1 ring-foreground/10 hover:enabled:bg-muted/70",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-y-0 left-0 transition-[width]",
                    isOwn ? "bg-action-foreground/15" : "bg-primary/10",
                  )}
                  style={{ width: `${Math.round(ratio * 100)}%` }}
                />
                <span
                  aria-hidden
                  className={cn(
                    "relative flex size-4 shrink-0 items-center justify-center rounded-full border",
                    chosen
                      ? isOwn
                        ? "border-action-foreground bg-action-foreground text-action"
                        : "border-action bg-action text-action-foreground"
                      : isOwn
                        ? "border-action-foreground/50"
                        : "border-muted-foreground/50",
                  )}
                >
                  {chosen ? (
                    <CheckIcon className="size-3" strokeWidth={3} />
                  ) : null}
                </span>
                <span className="relative min-w-0 flex-1 break-words">
                  {option.label}
                </span>
                <span
                  className={cn(
                    "relative shrink-0 text-xs tabular-nums",
                    isOwn ? "opacity-80" : "text-muted-foreground",
                  )}
                >
                  {option.count}명
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-2">
        {onShowVoters ? (
          <button
            type="button"
            onClick={onShowVoters}
            className={cn(
              "rounded text-xs underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              isOwn ? "opacity-80" : "text-muted-foreground",
            )}
          >
            {voters}명 참여
          </button>
        ) : (
          <span
            className={cn(
              "text-xs",
              isOwn ? "opacity-80" : "text-muted-foreground",
            )}
          >
            {voters}명 참여
          </span>
        )}
        {isOwn && !closed && onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn(
              "h-6",
              isOwn &&
                "text-action-foreground hover:bg-action-foreground/15 hover:text-action-foreground",
            )}
            onClick={onClose}
          >
            <LockIcon aria-hidden data-icon="inline-start" />
            투표 종료
          </Button>
        ) : null}
      </div>
    </div>
  );
}
