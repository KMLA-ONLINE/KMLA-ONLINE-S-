import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { cn } from "~/shared/lib/utils";

/** 댓글 시트와 반응 목록 시트가 함께 쓰는 하단 시트 자리. 넓은 화면에서는 아무것도 바꾸지 않는다. */
const BOTTOM_SHEET_CLASS =
  "max-[1025px]:top-auto max-[1025px]:bottom-0 max-[1025px]:h-[98svh] max-[1025px]:max-h-[98svh] max-[1025px]:rounded-t-2xl max-[1025px]:rounded-b-none max-[1025px]:translate-y-[var(--sheet-drag-offset,0px)] max-[1025px]:data-open:zoom-in-100 max-[1025px]:data-open:slide-in-from-bottom-4 max-[1025px]:data-closed:zoom-out-100 max-[1025px]:data-closed:slide-out-to-bottom-4 max-sm:left-0 max-sm:max-w-full max-sm:translate-x-0 sm:max-[1025px]:left-1/2 sm:max-[1025px]:max-w-2xl sm:max-[1025px]:-translate-x-1/2";

const DISMISS_DRAG_DISTANCE = 96;
/** 목록에서 시작한 손짓을 당기기로 볼 최소 거리. 그 전에는 브라우저의 스크롤로 둔다. */
const PULL_START_SLOP = 6;
const SHEET_VIEWPORT_QUERY = "(max-width: 1024px) and (hover: none)";

function subscribeToSheetViewport(onChange: () => void) {
  const query = window.matchMedia(SHEET_VIEWPORT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isSheetViewport() {
  return window.matchMedia(SHEET_VIEWPORT_QUERY).matches;
}

/** 하단 시트를 쓰는 환경인가(폭 1024px 이하이고 터치가 주 입력). */
export function useSheetViewport() {
  return useSyncExternalStore(
    subscribeToSheetViewport,
    isSheetViewport,
    () => false,
  );
}

/**
 * 하단 시트를 아래로 끌어 닫는 손짓. 손잡이의 포인터 드래그와, 맨 위까지 올린 목록에서 이어 당기는
 * 터치를 함께 받는다. 팝업에는 `sheetClassName`과 `sheetStyle`을, 손잡이에는 `handleProps`를 준다.
 */
export function useSheetDrag({
  enabled,
  open = true,
  scrollElement,
  onDismiss,
}: {
  enabled: boolean;
  /** 닫혀도 마운트돼 있는 시트가 넘긴다. 다시 열 때 지난 오프셋을 지운다. */
  open?: boolean;
  /** 맨 위에서 이어 당기면 닫힐 스크롤 영역. 포털이 늦게 붙으므로 ref가 아니라 값으로 받는다. */
  scrollElement: HTMLElement | null;
  onDismiss: () => void;
}) {
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ pointerId: number; y: number } | null>(null);

  const reset = useCallback(() => {
    dragStart.current = null;
    setDragging(false);
    setDragOffset(0);
  }, []);

  // 닫힌 동안 끌어내린 자리를 지켜야 해서 닫을 때가 아니라 열 때 되돌린다.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDragging(false);
      setDragOffset(0);
    }
  }

  /** 손을 뗀 자리로 시트를 놓는다. 닫을 거리면 오프셋을 두어 그 자리에서 내려가게 하고 true를 준다. */
  const settle = useCallback((distance: number) => {
    setDragging(false);
    if (distance >= DISMISS_DRAG_DISTANCE) return true;
    setDragOffset(0);
    return false;
  }, []);

  const handleProps = {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!enabled) return;
      // 누를 것 위에서 시작한 손짓은 시트가 가로채지 않는다. 96px을 넘겨 시트가 닫히는
      // 순간에도 클릭은 그대로 발생해서, 닫히면서 프로필로 넘어가는 일이 생긴다.
      if ((event.target as Element).closest("a, button")) return;
      dragStart.current = { pointerId: event.pointerId, y: event.clientY };
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      const start = dragStart.current;
      if (start?.pointerId !== event.pointerId) return;
      setDragOffset(Math.max(0, event.clientY - start.y));
    },
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
      const start = dragStart.current;
      if (start?.pointerId !== event.pointerId) return;
      const distance = Math.max(0, event.clientY - start.y);
      dragStart.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      if (settle(distance)) onDismiss();
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (dragStart.current?.pointerId !== event.pointerId) return;
      reset();
    },
  };

  /**
   * 목록 맨 위에서 이어 아래로 당겨도 시트를 닫는다. 포인터 이벤트는 브라우저가 스크롤로 가져가 `pointercancel`로 끊기므로
   * passive 아닌 `touchmove`에서 `preventDefault`한다(`PullToRefresh`와 같다).
   */
  const dismiss = useEffectEvent(onDismiss);

  useEffect(() => {
    const container = scrollElement;
    if (!enabled || !container) return;

    let pull: { touchId: number; startY: number; distance: number } | null =
      null;

    const start = (event: TouchEvent) => {
      // 맨 위에 붙어 있을 때만 받는다. 중간에서는 같은 손짓이 스크롤이다.
      if (event.touches.length !== 1 || container.scrollTop > 0) return;
      const touch = event.touches[0];
      pull = { touchId: touch.identifier, startY: touch.clientY, distance: 0 };
    };

    const move = (event: TouchEvent) => {
      if (!pull) return;
      const touch = Array.from(event.touches).find(
        (candidate) => candidate.identifier === pull?.touchId,
      );
      if (!touch) return;

      const distance = touch.clientY - pull.startY;
      // 위로 밀었거나 목록이 다시 내려갔으면 평범한 스크롤이다. 손짓을 브라우저에 돌려준다.
      if (distance <= 0 || container.scrollTop > 0) {
        pull = null;
        reset();
        return;
      }
      if (distance < PULL_START_SLOP) return;

      event.preventDefault();
      pull.distance = distance;
      setDragging(true);
      setDragOffset(distance);
    };

    const finish = () => {
      const distance = pull?.distance ?? 0;
      pull = null;
      if (distance === 0) return;

      if (settle(distance)) dismiss();
    };

    container.addEventListener("touchstart", start, { passive: true });
    container.addEventListener("touchmove", move, { passive: false });
    container.addEventListener("touchend", finish);
    container.addEventListener("touchcancel", finish);

    return () => {
      container.removeEventListener("touchstart", start);
      container.removeEventListener("touchmove", move);
      container.removeEventListener("touchend", finish);
      container.removeEventListener("touchcancel", finish);
      // 끌던 중 화면 회전 등으로 시트 조건이 바뀌면 끝 이벤트를 받지 못해 어긋난 채 남는다.
      if (pull || dragStart.current) reset();
    };
  }, [enabled, scrollElement, reset, settle]);

  return {
    handleProps,
    sheetClassName: cn(
      BOTTOM_SHEET_CLASS,
      // `duration-200`을 쓰지 마라. 여닫는 애니메이션까지 늘어나 먼저 끝난 배경(100ms)이 시트가
      // 끝날 때까지 다시 나타나 닫을 때 화면이 깜박인다. 되돌아가는 전환 시간만 정한다.
      !dragging &&
        "max-[1025px]:transition-transform max-[1025px]:[transition-duration:200ms]",
    ),
    sheetStyle: { "--sheet-drag-offset": `${dragOffset}px` } as CSSProperties,
  };
}
