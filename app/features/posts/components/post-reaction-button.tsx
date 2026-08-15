import { ThumbsUpIcon } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";

import {
  QuickReactionBar,
  ReactionPickerSurface,
} from "~/features/posts/components/quick-reaction-bar";
import { ReactionEmoji } from "~/features/posts/components/reaction-emoji";
import {
  DEFAULT_REACTION,
  reactionLabel,
} from "~/features/posts/model/reactions";
import type {
  PostReaction,
  ReactionSummary,
} from "~/features/posts/model/types";
import { cn } from "~/shared/lib/utils";

/** 이 시간을 넘겨 누르고 있으면 종류 선택으로 본다. 짧은 탭과 겹치지 않을 만큼만 준다. */
const LONG_PRESS_MS = 350;
/** 데스크톱에서 마우스를 올린 채 기다렸을 때 피커가 뜨는 시간(기능 명세 §10.1). */
const HOVER_OPEN_MS = 700;

/**
 * 게시물 반응 버튼.
 *
 * 짧게 누르면 기본 반응을 붙이거나 뗀다. 꾹 누르거나(터치) 마우스를 올린 채 기다리면(데스크톱)
 * 종류를 고르는 줄이 뜬다 — 기능 명세 §10.1이 요구하는 두 가지 진입이다.
 */
export function PostReactionButton({
  summary,
  onSelect,
  onClear,
  className,
}: {
  summary: ReactionSummary;
  onSelect: (reaction: PostReaction) => void;
  onClear: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // 길게 눌러 피커를 연 손가락은 떼면서 click도 발생시킨다. 그 click까지 토글로 처리하면
  // 피커를 여는 동시에 기본 반응이 붙는다.
  const longPressed = useRef(false);

  const clearPressTimer = () => clearTimeout(pressTimer.current);
  const clearHoverTimer = () => clearTimeout(hoverTimer.current);

  useEffect(
    () => () => {
      clearTimeout(pressTimer.current);
      clearTimeout(hoverTimer.current);
    },
    [],
  );

  // 터치는 `pointerType`이 "touch"라 여기서 걸러진다. 터치 기기에서 hover로 열면 스크롤하다
  // 스친 버튼이 멋대로 열린다.
  const handlePointerEnter = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    clearHoverTimer();
    hoverTimer.current = setTimeout(() => setOpen(true), HOVER_OPEN_MS);
  };

  const handlePointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    clearHoverTimer();
    setOpen(false);
  };

  const mine = summary.my_reaction;

  return (
    <div
      className="relative"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      {open ? (
        <ReactionPickerSurface
          onDismiss={() => setOpen(false)}
          className="mb-2"
        >
          <QuickReactionBar
            current={mine}
            onSelect={(reaction) => {
              setOpen(false);
              // 이미 고른 것을 다시 고르면 해제다(기능 명세 §10.1).
              if (reaction === mine) onClear();
              else onSelect(reaction);
            }}
          />
        </ReactionPickerSurface>
      ) : null}

      <button
        type="button"
        aria-label={mine ? `${reactionLabel(mine)} 취소` : "반응 남기기"}
        aria-pressed={mine !== null}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors select-none hover:bg-muted",
          mine
            ? "font-medium text-primary"
            : "text-muted-foreground hover:text-foreground",
          className,
        )}
        onPointerDown={() => {
          longPressed.current = false;
          clearPressTimer();
          pressTimer.current = setTimeout(() => {
            longPressed.current = true;
            setOpen(true);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={clearPressTimer}
        onPointerLeave={clearPressTimer}
        // 길게 누르면 모바일 브라우저가 컨텍스트 메뉴를 띄운다. 롱프레스가 우리 몫이므로 막는다.
        onContextMenu={(event) => event.preventDefault()}
        onClick={() => {
          if (longPressed.current) return;
          if (mine) onClear();
          else onSelect(DEFAULT_REACTION);
        }}
      >
        {mine ? (
          <ReactionEmoji reaction={mine} className="text-base" />
        ) : (
          <ThumbsUpIcon className="size-4.5" aria-hidden="true" />
        )}
        {summary.reaction_count > 0 ? summary.reaction_count : null}
      </button>
    </div>
  );
}
