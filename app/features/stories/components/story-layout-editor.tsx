import { useRef, type PointerEvent, type ReactNode } from "react";

import { storyPlacementStyle } from "~/features/stories/components/story-canvas";
import {
  moveStoryPlacement,
  scaleStoryPlacement,
  type StoryLayout,
  type StoryLayoutElement,
  type StoryPlacement,
} from "~/features/stories/model/story";
import { cn } from "~/shared/lib/utils";

/** 방향키 한 번에 옮기는 거리(캔버스 비율). Shift를 누르면 5배. */
const KEY_MOVE_STEP = 0.02;

/** `+`·`-` 한 번에 곱하는 배율. */
const KEY_SCALE_STEP = 1.1;

const ELEMENT_ATTRIBUTE = "data-story-element";

interface Gesture {
  kind: "drag" | "pinch";
  element: StoryLayoutElement;
  start: StoryPlacement;
  pointerId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  distance: number;
}

/**
 * 작성 창 캔버스에서 글과 링크를 끌어 옮기고 두 손가락으로 크기를 바꾼다. 처리기는 손잡이가
 * 아니라 캔버스 전체에 단다. 두 번째 손가락은 작은 글자 밖에 닿기 쉬운데, 손잡이에만 달면 그
 * 손가락을 받지 못해 핀치가 되지 않는다.
 *
 * 좌표 계산은 `moveStoryPlacement`·`scaleStoryPlacement`가 하고, 여기서는 포인터를 캔버스 비율로
 * 바꾸기만 한다.
 */
export function useStoryLayoutGestures({
  placements,
  selected,
  disabled,
  onSelect,
  onChange,
}: {
  placements: Required<StoryLayout>;
  selected: StoryLayoutElement | null;
  /** 올리는 중이다. 저장할 자리는 이미 정해졌으니 화면의 자리도 바꾸지 않는다. */
  disabled: boolean;
  onSelect: (element: StoryLayoutElement) => void;
  onChange: (element: StoryLayoutElement, placement: StoryPlacement) => void;
}) {
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<Gesture | null>(null);

  function distance() {
    const [a, b] = [...pointersRef.current.values()];

    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (disabled) return;

    const pointers = pointersRef.current;
    const rect = event.currentTarget.getBoundingClientRect();

    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 2 && selected) {
      gestureRef.current = {
        kind: "pinch",
        element: selected,
        start: placements[selected],
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        width: rect.width,
        height: rect.height,
        distance: distance(),
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    const element = (event.target as Element)
      .closest(`[${ELEMENT_ATTRIBUTE}]`)
      ?.getAttribute(ELEMENT_ATTRIBUTE) as
      StoryLayoutElement | null | undefined;

    if (pointers.size !== 1 || !element) return;

    onSelect(element);
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      kind: "drag",
      element,
      start: placements[element],
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
      distance: 0,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const pointers = pointersRef.current;
    const gesture = gestureRef.current;

    if (!pointers.has(event.pointerId)) return;

    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (!gesture || disabled || gesture.width === 0 || gesture.height === 0) {
      return;
    }

    if (gesture.kind === "pinch") {
      const current = distance();

      if (current > 0 && gesture.distance > 0) {
        onChange(
          gesture.element,
          scaleStoryPlacement(gesture.start, current / gesture.distance),
        );
      }
      return;
    }

    if (event.pointerId !== gesture.pointerId) return;

    onChange(
      gesture.element,
      moveStoryPlacement(
        gesture.start,
        (event.clientX - gesture.x) / gesture.width,
        (event.clientY - gesture.y) / gesture.height,
      ),
    );
  }

  function onPointerEnd(event: PointerEvent<HTMLElement>) {
    const pointers = pointersRef.current;
    const gesture = gestureRef.current;

    pointers.delete(event.pointerId);

    // 핀치에서 한 손가락을 떼면 남은 손가락으로 끌기를 이어 가지 않는다. 떼는 순간 손가락 사이의
    // 중점이 튀어 글이 엉뚱한 곳으로 뛴다.
    if (gesture?.kind === "pinch" && pointers.size < 2)
      gestureRef.current = null;
    if (gesture?.kind === "drag" && gesture.pointerId === event.pointerId) {
      gestureRef.current = null;
    }
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
  };
}

/**
 * 캔버스 위에서 옮길 수 있는 글이나 링크. 보이는 모양은 뷰어와 같은 `storyPlacementStyle`이고,
 * 포커스하면 방향키로 옮기고 `+`·`-`로 크기를 바꾼다.
 */
export const STORY_HANDLE_HELP_ID = "story-placed-handle-help";

/** 손잡이의 사용법. 손잡이 이름은 글이나 링크 그 자체로 두고 이 설명을 덧붙인다. */
export function StoryPlacedHandleHelp() {
  return (
    <p id={STORY_HANDLE_HELP_ID} className="sr-only">
      끌어서 옮기고 두 손가락으로 크기를 바꿉니다. 키보드로는 방향키로 옮기고 +,
      - 키로 크기를 바꿉니다.
    </p>
  );
}

export function StoryPlacedHandle({
  element,
  placement,
  selected,
  disabled,
  className,
  onSelect,
  onChange,
  children,
}: {
  element: StoryLayoutElement;
  placement: StoryPlacement;
  selected: boolean;
  disabled: boolean;
  className: string;
  onSelect: (element: StoryLayoutElement) => void;
  onChange: (element: StoryLayoutElement, placement: StoryPlacement) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      {...{ [ELEMENT_ATTRIBUTE]: element }}
      aria-describedby={STORY_HANDLE_HELP_ID}
      aria-pressed={selected}
      disabled={disabled}
      onFocus={() => onSelect(element)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? KEY_MOVE_STEP * 5 : KEY_MOVE_STEP;
        const moves: Record<string, [number, number] | undefined> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        const move = moves[event.key];

        if (move) {
          event.preventDefault();
          onChange(element, moveStoryPlacement(placement, ...move));
        } else if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          onChange(element, scaleStoryPlacement(placement, KEY_SCALE_STEP));
        } else if (event.key === "-") {
          event.preventDefault();
          onChange(element, scaleStoryPlacement(placement, 1 / KEY_SCALE_STEP));
        }
      }}
      style={storyPlacementStyle(placement)}
      className={cn(
        className,
        "cursor-move touch-none outline-none select-none",
        // 고른 요소를 점선으로 감싸 어느 것의 크기를 바꾸는지 알린다.
        selected &&
          "outline-2 outline-offset-[1.5cqw] outline-white/90 outline-dashed",
        "focus-visible:outline-2 focus-visible:outline-offset-[1.5cqw] focus-visible:outline-white focus-visible:outline-solid",
      )}
    >
      {children}
    </button>
  );
}
