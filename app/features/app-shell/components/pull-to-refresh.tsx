import { ArrowDownIcon, LoaderCircleIcon } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type RefObject,
} from "react";

import { cn } from "~/shared/lib/utils";

const TRIGGER_DISTANCE = 72;
const MAX_DISTANCE = 96;
const MINIMUM_REFRESH_INDICATOR_MS = 300;

interface GestureState {
  active: boolean;
  cancelled: boolean;
  startX: number;
  startY: number;
  touchId: number | null;
}

const IDLE_GESTURE: GestureState = {
  active: false,
  cancelled: false,
  startX: 0,
  startY: 0,
  touchId: null,
};

export function PullToRefresh({
  containerRef,
  enabled,
  onRefresh,
}: {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const gestureRef = useRef<GestureState>({ ...IDLE_GESTURE });
  const distanceRef = useRef(0);
  const suppressClickRef = useRef(false);
  const refreshEvent = useEffectEvent(onRefresh);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const setPullDistance = (nextDistance: number) => {
      distanceRef.current = nextDistance;
      setDistance(nextDistance);
    };

    const begin = (
      clientX: number,
      clientY: number,
      target: EventTarget | null,
      touchId: number | null,
    ) => {
      if (
        refreshing ||
        container.scrollTop > 0 ||
        shouldIgnoreGesture(target, container)
      ) {
        return;
      }

      gestureRef.current = {
        active: true,
        cancelled: false,
        startX: clientX,
        startY: clientY,
        touchId,
      };
    };

    const move = (clientX: number, clientY: number, event: Event) => {
      const gesture = gestureRef.current;
      if (!gesture.active || gesture.cancelled) return;

      const deltaX = clientX - gesture.startX;
      const deltaY = clientY - gesture.startY;
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 8) {
        gesture.cancelled = true;
        setPullDistance(0);
        return;
      }
      if (deltaY <= 0 || container.scrollTop > 0) {
        setPullDistance(0);
        return;
      }
      if (deltaY < 6) return;

      event.preventDefault();
      setPullDistance(Math.min(MAX_DISTANCE, deltaY * 0.55));
    };

    const finish = () => {
      if (!gestureRef.current.active) return;
      const shouldRefresh =
        !gestureRef.current.cancelled &&
        distanceRef.current >= TRIGGER_DISTANCE &&
        !refreshing;
      const didDrag = distanceRef.current > 6;
      gestureRef.current = { ...IDLE_GESTURE };
      setPullDistance(0);

      if (didDrag) suppressClickRef.current = true;
      if (!shouldRefresh) return;

      setRefreshing(true);
      void Promise.allSettled([
        refreshEvent(),
        new Promise((resolve) =>
          window.setTimeout(resolve, MINIMUM_REFRESH_INDICATOR_MS),
        ),
      ]).then(() => setRefreshing(false));
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      begin(touch.clientX, touch.clientY, event.target, touch.identifier);
    };
    const onTouchMove = (event: TouchEvent) => {
      const touchId = gestureRef.current.touchId;
      if (touchId === null) return;
      const touch = Array.from(event.touches).find(
        (candidate) => candidate.identifier === touchId,
      );
      if (touch) move(touch.clientX, touch.clientY, event);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      begin(event.clientX, event.clientY, event.target, null);
    };
    const onMouseMove = (event: MouseEvent) => {
      if (gestureRef.current.touchId !== null) return;
      move(event.clientX, event.clientY, event);
    };
    const onClick = (event: MouseEvent) => {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", finish);
    container.addEventListener("touchcancel", finish);
    container.addEventListener("mousedown", onMouseDown);
    container.addEventListener("click", onClick, true);
    window.addEventListener("mousemove", onMouseMove, { passive: false });
    window.addEventListener("mouseup", finish);

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", finish);
      container.removeEventListener("touchcancel", finish);
      container.removeEventListener("mousedown", onMouseDown);
      container.removeEventListener("click", onClick, true);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", finish);
    };
  }, [containerRef, enabled, refreshing]);

  const armed = distance >= TRIGGER_DISTANCE;
  const visible = refreshing || distance > 0;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 top-4 z-50 flex justify-center",
        !visible && "invisible",
      )}
      aria-live="polite"
      aria-hidden={!visible}
      role="status"
    >
      <div
        data-slot="pull-to-refresh-indicator"
        data-state={refreshing ? "refreshing" : armed ? "armed" : "pulling"}
        className={cn(
          "flex h-9 items-center justify-center rounded-full border bg-background/95 text-sm font-medium text-muted-foreground shadow-md backdrop-blur transition-[width,opacity,transform] duration-150 motion-reduce:transition-none",
          refreshing ? "gap-2 px-3" : "w-9",
          !visible && "-translate-y-3 opacity-0",
          armed && !refreshing && "text-foreground",
        )}
        style={{
          transform: visible
            ? `translateY(${refreshing ? 10 : Math.min(16, distance * 0.2)}px)`
            : undefined,
        }}
      >
        {refreshing ? (
          <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <ArrowDownIcon
            className={cn(
              "size-4 transition-transform motion-reduce:transition-none",
              armed && "rotate-180",
            )}
          />
        )}
        {refreshing ? <span>새로고침 중</span> : null}
        {!refreshing ? (
          <span className="sr-only">
            {armed ? "놓아서 새로고침" : "아래로 당겨 새로고침"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function shouldIgnoreGesture(
  target: EventTarget | null,
  container: HTMLElement,
) {
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="dialog"], [data-pull-to-refresh-ignore]',
    )
  ) {
    return true;
  }

  let current: Element | null = target;
  while (current && current !== container) {
    if (current instanceof HTMLElement) {
      const overflowY = getComputedStyle(current).overflowY;
      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        current.scrollHeight > current.clientHeight
      ) {
        return true;
      }
    }
    current = current.parentElement;
  }
  return false;
}
