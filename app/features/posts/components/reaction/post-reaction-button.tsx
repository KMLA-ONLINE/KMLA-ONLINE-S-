import { ThumbsUpIcon } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";

import {
  QuickReactionBar,
  ReactionPickerSurface,
} from "~/features/posts/components/reaction/quick-reaction-bar";
import { ReactionEmoji } from "~/features/posts/components/reaction/reaction-emoji";
import {
  DEFAULT_REACTION,
  reactionLabel,
  reactionTone,
} from "~/features/posts/model/reactions";
import type {
  PostReaction,
  ReactionSummary,
} from "~/features/posts/model/types";
import { useT } from "~/shared/i18n";
import { cn } from "~/shared/lib/utils";

/** 이 시간을 넘겨 누르고 있으면 종류 선택으로 본다. 짧은 탭과 겹치지 않을 만큼만 준다. */
const LONG_PRESS_MS = 350;
/** 데스크톱에서 마우스를 올린 채 기다렸을 때 피커가 뜨는 시간(기능 명세 §10.1). */
const HOVER_OPEN_MS = 500;
/** 마우스가 떠난 뒤 피커를 닫기까지의 여유. 버튼과 줄 사이 틈을 건너는 동안 닫히지 않게 한다. */
const HOVER_CLOSE_MS = 250;

/**
 * 게시물 반응 버튼. 짧게 누르면 기본 반응 토글, 꾹 누르거나(터치) 호버하면(데스크톱) 종류 줄이 뜬다(기능 명세 §10.1).
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
  // hover로 연 줄은 마우스가 떠나면 닫히고, 누르거나 꾹 눌러 연 줄은 바깥을 눌러야 닫힌다.
  const t = useT();
  const [open, setOpen] = useState<"hover" | "press" | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // 길게 눌러 피커를 연 손가락은 떼면서 click도 발생시킨다. 그 click까지 토글로 처리하면
  // 피커를 여는 동시에 기본 반응이 붙는다.
  const longPressed = useRef(false);

  const clearPressTimer = () => clearTimeout(pressTimer.current);
  const clearHoverTimer = () => clearTimeout(hoverTimer.current);
  const close = () => {
    clearHoverTimer();
    // 롱프레스 표시는 다음 pointerdown까지 남는다. 닫을 때 지우지 않으면 키보드의 첫 Enter가 롱프레스 뒤 click으로 오인돼 삼켜진다.
    longPressed.current = false;
    setOpen(null);
  };

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
    if (open) return;
    hoverTimer.current = setTimeout(() => setOpen("hover"), HOVER_OPEN_MS);
  };

  const handlePointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    clearHoverTimer();
    if (open === "press") return;
    hoverTimer.current = setTimeout(() => setOpen(null), HOVER_CLOSE_MS);
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
          modal={open === "press"}
          onDismiss={close}
          className="mb-2"
        >
          <QuickReactionBar
            current={mine}
            onSelect={(reaction) => {
              close();
              // 이미 고른 것을 다시 고르면 해제다(기능 명세 §10.1).
              if (reaction === mine) onClear();
              else onSelect(reaction);
            }}
          />
        </ReactionPickerSurface>
      ) : null}

      <button
        type="button"
        // 짧게 누르면 무엇이 붙는지 이름에 담는다. 화면에는 아이콘과 숫자뿐이다.
        aria-label={
          mine
            ? t("{reaction} 취소", { reaction: t(reactionLabel(mine)) })
            : t("{reaction} 남기기", {
                reaction: t(reactionLabel(DEFAULT_REACTION)),
              })
        }
        aria-pressed={mine !== null}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors select-none [-webkit-touch-callout:none] hover:bg-muted",
          mine
            ? cn("font-medium", reactionTone(mine))
            : "text-muted-foreground hover:text-foreground",
          className,
        )}
        onPointerDown={() => {
          longPressed.current = false;
          clearPressTimer();
          pressTimer.current = setTimeout(() => {
            longPressed.current = true;
            clearHoverTimer();
            setOpen("press");
          }, LONG_PRESS_MS);
        }}
        onPointerUp={clearPressTimer}
        onPointerLeave={clearPressTimer}
        // 길게 누르면 모바일 브라우저가 컨텍스트 메뉴를 띄운다. 롱프레스가 우리 몫이므로 막는다.
        onContextMenu={(event) => event.preventDefault()}
        onClick={() => {
          if (longPressed.current) return;
          close();
          if (mine) onClear();
          else onSelect(DEFAULT_REACTION);
        }}
      >
        {mine ? (
          // 이모지는 `em` 크기라 글자 크기로 조절한다. 색이 꽉 찬 그림이라 `size-5` 선 아이콘보다 한 단계 작게 둔다.
          <ReactionEmoji reaction={mine} className="text-base" />
        ) : (
          <ThumbsUpIcon className="size-5" aria-hidden="true" />
        )}
        {summary.reaction_count > 0 ? summary.reaction_count : null}
      </button>
    </div>
  );
}
