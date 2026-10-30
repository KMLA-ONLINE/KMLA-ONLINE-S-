import { SmilePlusIcon } from "lucide-react";

import { cn } from "~/shared/lib/utils";

/**
 * 한 번에 누르는 빠른 반응. 페이스북 메신저의 기본 줄과 같은 여섯 개이고, 게시물 반응 여섯 종과 그림만
 * 같다(기능 명세 §13.8). 순서는 줄에 보이는 순서다.
 */
export const QUICK_MESSAGE_REACTIONS = [
  "👍",
  "❤️",
  "😆",
  "😮",
  "😢",
  "😡",
] as const;

/** 두 번 탭했을 때 남는 반응(기능 명세 §13.8). */
export const DOUBLE_TAP_MESSAGE_REACTION = "❤️";

/**
 * 메시지 반응 줄. 빠른 반응 여섯 개 뒤에 더 보기 버튼이 있고, 더 보기는 이모지 전체 선택창을 연다.
 * 선택창은 부모(`onMore`)가 연다 — 이 줄은 context menu처럼 곧 닫히는 곳에 있어서 줄과 함께
 * 창이 사라지기 때문이다.
 */
export function MessageReactionBar({
  current,
  onSelect,
  onMore,
}: {
  current?: string | null;
  onSelect: (reaction: string) => void;
  onMore: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="빠른 반응"
      className="flex flex-nowrap items-center gap-0.5"
    >
      {QUICK_MESSAGE_REACTIONS.map((emoji) => {
        const chosen = current === emoji;
        return (
          <button
            key={emoji}
            type="button"
            aria-label={`${emoji} 반응 ${chosen ? "취소" : "남기기"}`}
            aria-pressed={chosen}
            className={cn(
              "flex size-10 shrink-0 origin-bottom items-center justify-center rounded-full text-2xl leading-none transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] select-none [-webkit-touch-callout:none] hover:-translate-y-0.5 hover:scale-125 focus-visible:-translate-y-1.5 focus-visible:scale-125 focus-visible:outline-none",
              // 말풍선 바탕(`bg-popover`)과 붙어 보이지 않게 회색보다 한 단계 짙은 브랜드 색을 연하게 깐다.
              chosen && "bg-primary/10",
            )}
            onClick={() => onSelect(emoji)}
          >
            {emoji}
          </button>
        );
      })}
      <button
        type="button"
        aria-label="다른 이모지 고르기"
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onClick={onMore}
      >
        <SmilePlusIcon aria-hidden className="size-6" />
      </button>
    </div>
  );
}
