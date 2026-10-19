import type { ReactNode } from "react";

import { ReactionEmoji } from "~/features/posts/components/reaction/reaction-emoji";
import { REACTION_TYPES } from "~/features/posts/model/reactions";
import type { PostReaction } from "~/features/posts/model/types";
import { cn } from "~/shared/lib/utils";

/**
 * 반응 종류를 고르는 한 줄. 이미 고른 반응은 줄 안에서도 표시한다 — 줄이 여는 버튼을 덮고 있어
 * 버튼만으로는 무엇을 골랐는지, 다시 누르면 해제된다는 것을 알 수 없다.
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
      {REACTION_TYPES.map((type, index) => {
        const chosen = current === type.key;
        const label = chosen ? `${type.label} 취소` : type.label;
        return (
          // 이름표는 버튼 밖에 둔다. 버튼 안이면 hover 확대에 이름표 글자까지 커진다.
          <span key={type.key} className="group relative flex">
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute bottom-full mb-1.5 rounded-full bg-foreground px-2 py-0.5 text-xs font-medium whitespace-nowrap text-background opacity-0 transition-opacity group-hover:opacity-100 [.group:has(:focus-visible)>&]:opacity-100",
                // 줄은 여는 버튼의 왼쪽 끝에 붙는다. 첫 이름표까지 가운데에 두면 "좋아요 취소"가 줄 밖, 화면 밖으로 나간다.
                index === 0 ? "left-0" : "left-1/2 -translate-x-1/2",
              )}
            >
              {label}
            </span>
            <button
              type="button"
              aria-label={`${type.label} 반응 ${chosen ? "취소" : "남기기"}`}
              aria-pressed={chosen}
              className={cn(
                "flex size-10 shrink-0 origin-bottom items-center justify-center rounded-full text-2xl transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] [-webkit-touch-callout:none] hover:-translate-y-0.5 hover:scale-125 focus-visible:-translate-y-1.5 focus-visible:scale-125 focus-visible:outline-none",
                // 말풍선 바탕(`bg-popover`)과 붙어 보이지 않게 회색보다 한 단계 짙은 브랜드 색을 연하게 깐다.
                chosen && "bg-primary/10",
              )}
              onClick={() => onSelect(type.key)}
            >
              <ReactionEmoji reaction={type.key} />
            </button>
          </span>
        );
      })}
    </div>
  );
}

/**
 * 빠른 반응 줄 말풍선. hover로도 열려야 해서 포커스를 가져가는 Base UI Popover 대신 직접 그린다.
 * `modal`이면 투명 버튼을 깔아 바깥 클릭으로 닫는다. hover로 연 줄에는 깔지 않는다 — 깔면 화면 전체가
 * 줄의 일부가 되어 마우스가 떠나도 닫히지 않고, 다른 버튼을 누른 클릭도 가로챈다.
 */
export function ReactionPickerSurface({
  modal = true,
  onDismiss,
  className,
  children,
}: {
  modal?: boolean;
  onDismiss: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <>
      {modal ? (
        <button
          type="button"
          aria-label="반응 선택 닫기"
          className="fixed inset-0 z-40 cursor-default"
          onClick={onDismiss}
        />
      ) : null}
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
