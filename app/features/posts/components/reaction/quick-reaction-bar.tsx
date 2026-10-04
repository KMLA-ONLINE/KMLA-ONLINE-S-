import type { ReactNode } from "react";

import { ReactionEmoji } from "~/features/posts/components/reaction/reaction-emoji";
import { REACTION_TYPES } from "~/features/posts/model/reactions";
import type { PostReaction } from "~/features/posts/model/types";
import { cn } from "~/shared/lib/utils";

/** 반응 종류를 고르는 한 줄. 이미 고른 반응은 `aria-pressed`만 준다 — 여는 버튼이 이미 보여준다. */
export function QuickReactionBar({
  current,
  onSelect,
}: {
  current?: PostReaction | null;
  onSelect: (reaction: PostReaction) => void;
}) {
  return (
    <div className="flex flex-nowrap items-center gap-1">
      {REACTION_TYPES.map((type) => (
        <button
          key={type.key}
          type="button"
          aria-label={`${type.label} 반응 남기기`}
          aria-pressed={current === type.key}
          className="flex size-10 shrink-0 origin-bottom items-center justify-center rounded-full text-2xl transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] [-webkit-touch-callout:none] hover:-translate-y-0.5 hover:scale-125 focus-visible:-translate-y-1.5 focus-visible:scale-125 focus-visible:outline-none"
          onClick={() => onSelect(type.key)}
        >
          <ReactionEmoji reaction={type.key} />
        </button>
      ))}
    </div>
  );
}

/** 빠른 반응 줄 말풍선. hover로도 열려야 해서 포커스를 가져가는 Base UI Popover 대신 투명 버튼을 깔아 바깥 클릭으로 닫는다. */
export function ReactionPickerSurface({
  onDismiss,
  className,
  children,
}: {
  onDismiss: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="반응 선택 닫기"
        className="fixed inset-0 z-40 cursor-default"
        onClick={onDismiss}
      />
      <div
        className={cn(
          "absolute bottom-full left-0 z-50 rounded-full border bg-popover p-1 shadow-md",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}
