import type { ReactNode } from "react";

import { ReactionEmoji } from "~/features/posts/components/reaction-emoji";
import { REACTION_TYPES } from "~/features/posts/model/reactions";
import type { PostReaction } from "~/features/posts/model/types";
import { cn } from "~/shared/lib/utils";

/**
 * 반응 종류를 고르는 한 줄. 게시물 버튼과 댓글 버튼이 같은 줄을 쓴다(기능 명세 §10.1).
 *
 * 이미 고른 반응에는 `aria-pressed`만 준다. 눌린 모양을 따로 그리지 않는 건, 이 줄을 여는
 * 버튼 자체가 지금 고른 반응을 이미 보여주고 있기 때문이다.
 */
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

/**
 * 빠른 반응 줄을 띄우는 말풍선.
 *
 * 화면 전체를 덮는 투명 버튼을 함께 깔아 바깥을 누르면 닫히게 한다. Base UI의 Popover를 쓰지
 * 않는 건 이 줄이 hover만으로도 열려야 해서다 — 포커스를 가져가는 순간 마우스를 옮기다 열린
 * 피커가 뒤에 있던 입력창의 포커스를 빼앗는다.
 */
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
