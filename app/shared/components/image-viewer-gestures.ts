import {
  useEffect,
  useEffectEvent,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import {
  IDENTITY,
  MAX_ZOOM,
  MIN_ZOOM,
  clamp,
  clampZoom,
  frameContains,
  pinchZoom,
  rubberBand,
  rubberBandZoom,
  zoomAt,
  type FrameLayout,
  type Point,
  type ZoomTransform,
} from "~/shared/lib/image-viewer-geometry";

/** 슬라이드 사이의 간격. 넘기는 동안 두 사진이 맞붙어 보이지 않게 한다. */
export const PAGE_GAP = 16;
export const DOUBLE_TAP_ZOOM = 2;
export const ZOOM_STEP = 1.5;

const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
const SLIDE_MS = 320;
const ZOOM_MS = 260;
const SETTLE_MS = 260;
const DISMISS_MS = 200;
const MOMENTUM_MS = 420;
/** 손을 뗀 속도(px/ms)에 곱해 관성으로 더 미끄러질 거리를 정한다. */
const MOMENTUM_DISTANCE = 160;

/** 이 거리 안에서 움직인 손가락은 아직 탭이다. 손떨림을 스와이프로 읽지 않는다. */
const TOUCH_SLOP = 10;
/** 마우스는 떨림이 거의 없어서, 이만큼만 움직여도 클릭이 아니라 끌기다. */
const MOUSE_SLOP = 4;
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_SLOP = 32;
const VELOCITY_WINDOW_MS = 100;

const PAGE_DISTANCE = 80;
const PAGE_DISTANCE_RATIO = 0.2;
const FLICK_VELOCITY = 0.35;
const DISMISS_DISTANCE_RATIO = 0.18;
const DISMISS_VELOCITY = 0.6;

/** 제스처가 알아야 하는 현재 기하. `origin`은 뷰포트의 client 좌표 원점이다. */
export interface ViewerLayout extends FrameLayout {
  origin: Point;
}

const NO_OFFSET: Point = { x: 0, y: 0 };

function readMatrix(element: HTMLElement): DOMMatrixReadOnly | null {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === "none" || typeof DOMMatrix === "undefined") {
    return null;
  }
  return new DOMMatrix(transform);
}

function zoomCss(zoom: ZoomTransform): string {
  return `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})`;
}

/**
 * 뷰어가 움직이는 모든 것의 위치를 쥐고 DOM에 직접 쓴다.
 *
 * 손가락을 따라가는 값을 React state로 흘리면 매 프레임 렌더가 끼고, 커밋이 늦은 값이 다음
 * 이벤트와 싸운다. 그래서 움직이는 동안은 여기서만 쓰고 React에는 손을 뗀 결과만 알린다.
 * React는 이 요소들의 `transform`·`transition`·`opacity`를 건드리지 않는다.
 */
export class ViewerMotion {
  track: HTMLElement | null = null;
  slide: HTMLElement | null = null;
  frame: HTMLElement | null = null;
  backdrop: HTMLElement | null = null;
  chrome: HTMLElement | null = null;
  reducedMotion = false;

  pageWidth = 0;
  index = 0;
  /** 트랙이 현재 장의 정지 위치에서 벗어난 거리. */
  offset = 0;
  zoom: ZoomTransform = IDENTITY;
  dismiss: Point = NO_OFFSET;

  private transition(property: string, ms: number): string {
    return this.reducedMotion || ms === 0
      ? "none"
      : `${property} ${ms}ms ${EASE_OUT}`;
  }

  setTrack(offset: number, ms = 0) {
    this.offset = offset;
    const track = this.track;
    if (!track) return;
    track.style.transition = this.transition("transform", ms);
    track.style.transform = `translate3d(${-this.index * this.pageWidth + offset}px, 0, 0)`;
  }

  /** 현재 장의 정지 위치로 보낸다. 이웃한 장으로 옮겼다면 지금 그려진 자리에서 미끄러져 간다. */
  restTrack(animate: boolean) {
    this.setTrack(0, animate ? SLIDE_MS : 0);
  }

  setZoom(zoom: ZoomTransform, ms = 0) {
    this.zoom = zoom;
    const frame = this.frame;
    if (!frame) return;
    frame.style.transition = this.transition("transform", ms);
    frame.style.transform = zoomCss(zoom);
  }

  /** 끌어 닫기. 진행도에 따라 사진이 조금 작아지고 바탕과 조작부가 옅어진다. */
  setDismiss(offset: Point, progress: number, ms = 0) {
    this.dismiss = offset;
    if (this.slide) {
      this.slide.style.transition = this.transition("transform", ms);
      this.slide.style.transform =
        progress === 0 && offset.x === 0 && offset.y === 0
          ? ""
          : `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${1 - progress * 0.15})`;
    }
    if (this.backdrop) {
      this.backdrop.style.transition = this.transition("opacity", ms);
      this.backdrop.style.opacity = progress === 0 ? "" : `${1 - progress}`;
    }
    if (this.chrome) {
      this.chrome.style.transition = this.transition("opacity", ms);
      this.chrome.style.opacity =
        progress === 0 ? "" : `${Math.max(0, 1 - progress * 4)}`;
    }
  }

  /** 다른 장이 된 틀을 원래 크기로 돌린다. 화면 밖으로 나가는 중이라 튀어 보이지 않는다. */
  releaseFrame(frame: HTMLElement) {
    frame.style.transition = this.transition("transform", ZOOM_MS);
    frame.style.transform = "";
  }

  /**
   * 애니메이션 도중에 손가락을 대면 지금 그려진 자리에서 이어받는다. 목표 지점에서 시작하면
   * 손을 대는 순간 화면이 튄다.
   */
  grab() {
    if (this.track && this.track.style.transition !== "none") {
      const matrix = readMatrix(this.track);
      this.setTrack(
        matrix ? matrix.m41 + this.index * this.pageWidth : this.offset,
      );
    }
    if (this.frame && this.frame.style.transition !== "none") {
      const matrix = readMatrix(this.frame);
      this.setZoom(
        matrix ? { scale: matrix.a, x: matrix.m41, y: matrix.m42 } : this.zoom,
      );
    }
  }
}

type GestureMode =
  "idle" | "pending" | "slide" | "dismiss" | "pan" | "pinch" | "mouse";

interface Sample extends Point {
  t: number;
}

interface GestureState {
  mode: GestureMode;
  pointers: Map<number, Point>;
  start: Point;
  base: ZoomTransform;
  pinch: { midpoint: Point; distance: number; zoom: ZoomTransform } | null;
  samples: Sample[];
  /** 이번 제스처 중에 손가락이 둘 이상 닿았다. 그 뒤의 손 떼기는 탭이 아니다. */
  multiTouch: boolean;
  mouseMoved: boolean;
  lastTap: Sample | null;
  tapTimer: ReturnType<typeof setTimeout> | null;
}

function pointerPair(pointers: Map<number, Point>) {
  const [first, second] = Array.from(pointers.values());
  if (!first || !second) return null;
  return {
    distance: Math.hypot(second.x - first.x, second.y - first.y),
    midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
  };
}

function velocity(samples: Sample[]): Point {
  const now = Date.now();
  const recent = samples.filter(
    (sample) => now - sample.t <= VELOCITY_WINDOW_MS,
  );
  const first = recent[0];
  const last = recent.at(-1);
  if (!first || !last || last.t === first.t) return NO_OFFSET;
  const elapsed = last.t - first.t;
  return { x: (last.x - first.x) / elapsed, y: (last.y - first.y) / elapsed };
}

export interface ViewerGestureOptions {
  motion: RefObject<ViewerMotion>;
  viewport: RefObject<HTMLElement | null>;
  /** 현재 장의 기하. 이미지 치수를 아직 모르면 `null`이고, 그동안은 확대하지 않는다. */
  getLayout: () => ViewerLayout | null;
  canPage: (direction: -1 | 1) => boolean;
  onPage: (direction: -1 | 1) => void;
  /** 확정된 한 번 탭(두 번째 탭을 기다린 뒤). */
  onTap: () => void;
  onDismiss: () => void;
  /** 손을 뗀 뒤의 확대 상태. 커서나 버튼처럼 React가 그리는 것만 이 값을 쓴다. */
  onZoomChange: (zoom: ZoomTransform) => void;
  /** 확대 제스처가 시작됐다. 조작부를 비켜 준다. */
  onZoomGesture: () => void;
}

/**
 * 터치·펜·마우스·휠 입력을 해석한다.
 *
 * 터치는 한 손가락이 움직이기 전까지 판정을 미룬다. 확대돼 있으면 이동, 1배에서 가로로 움직이면
 * 넘기기, 세로면 끌어 닫기다. 한 번 정한 축은 손을 뗄 때까지 바꾸지 않는다. 두 번째 손가락이
 * 닿으면 무엇을 하던 중이든 제자리로 돌리고 확대로 넘어간다.
 *
 * 마우스는 넘기거나 끌어 닫지 않는다 — 그 어포던스는 화살표와 닫기 버튼이다. 대신 클릭으로
 * 확대하고, 휠로 배율을 바꾸고, 확대된 이미지를 끌어서 옮긴다.
 */
export function useViewerGestures(options: ViewerGestureOptions) {
  const { motion, viewport, getLayout } = options;
  const gesture = useRef<GestureState>({
    mode: "idle",
    pointers: new Map(),
    start: NO_OFFSET,
    base: IDENTITY,
    pinch: null,
    samples: [],
    multiTouch: false,
    mouseMoved: false,
    lastTap: null,
    tapTimer: null,
  });

  const toLocal = (event: { clientX: number; clientY: number }): Point => {
    const origin = getLayout()?.origin ?? NO_OFFSET;
    return { x: event.clientX - origin.x, y: event.clientY - origin.y };
  };

  const clearTapTimer = () => {
    const state = gesture.current;
    if (state.tapTimer === null) return;
    clearTimeout(state.tapTimer);
    state.tapTimer = null;
  };

  useEffect(() => clearTapTimer, []);

  const zoomTo = (zoom: ZoomTransform, ms = ZOOM_MS) => {
    motion.current.setZoom(zoom, ms);
    options.onZoomChange(zoom);
  };

  /** 버튼과 키보드용. 틀의 가운데를 기준으로 배율을 곱한다. */
  const zoomBy = (factor: number) => {
    const layout = getLayout();
    if (!layout) return;
    const current = motion.current.zoom;
    const scale = clamp(current.scale * factor, MIN_ZOOM, MAX_ZOOM);
    zoomTo(clampZoom(zoomAt(current, scale, layout.center, layout), layout));
  };

  const resetZoom = () => zoomTo(IDENTITY);

  const toggleZoomAt = (point: Point) => {
    const layout = getLayout();
    if (!layout) return;
    const current = motion.current.zoom;
    if (current.scale > MIN_ZOOM) {
      zoomTo(IDENTITY);
      return;
    }
    zoomTo(clampZoom(zoomAt(current, DOUBLE_TAP_ZOOM, point, layout), layout));
  };

  const handleTap = (point: Point) => {
    const state = gesture.current;
    const now = Date.now();
    const previous = state.lastTap;

    if (
      previous &&
      now - previous.t < DOUBLE_TAP_MS &&
      Math.hypot(point.x - previous.x, point.y - previous.y) < DOUBLE_TAP_SLOP
    ) {
      state.lastTap = null;
      clearTapTimer();
      if (motion.current.zoom.scale === MIN_ZOOM) options.onZoomGesture();
      toggleZoomAt(point);
      return;
    }

    state.lastTap = { ...point, t: now };
    clearTapTimer();
    // 두 번째 탭이 오면 확대이므로, 한 번 탭(조작부 토글)은 그 창이 닫힌 뒤에 확정한다.
    state.tapTimer = setTimeout(() => {
      state.tapTimer = null;
      state.lastTap = null;
      options.onTap();
    }, DOUBLE_TAP_MS);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const state = gesture.current;
    const current = motion.current;
    const point = toLocal(event);

    if (event.pointerType === "mouse") {
      current.grab();
      state.mode = "mouse";
      state.start = point;
      state.base = current.zoom;
      state.mouseMoved = false;
      state.pointers.set(event.pointerId, point);
      // 마우스는 뷰포트 밖으로 나가도 끌기가 이어지도록 잡는다. 터치는 브라우저가 알아서 잡는다.
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    state.pointers.set(event.pointerId, point);

    if (state.pointers.size === 1) {
      current.grab();
      state.mode = "pending";
      state.start = point;
      state.samples = [{ ...point, t: Date.now() }];
      state.multiTouch = false;
      return;
    }

    const pair = pointerPair(state.pointers);
    if (state.pointers.size !== 2 || !pair || pair.distance === 0) return;

    clearTapTimer();
    state.lastTap = null;
    state.multiTouch = true;
    if (state.mode === "slide") current.setTrack(0, SLIDE_MS);
    if (state.mode === "dismiss") current.setDismiss(NO_OFFSET, 0, SETTLE_MS);
    current.grab();
    state.mode = "pinch";
    state.pinch = { ...pair, zoom: current.zoom };
    options.onZoomGesture();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const state = gesture.current;
    if (!state.pointers.has(event.pointerId)) return;

    const point = toLocal(event);
    state.pointers.set(event.pointerId, point);
    const current = motion.current;
    const layout = getLayout();
    const dx = point.x - state.start.x;
    const dy = point.y - state.start.y;

    if (state.mode === "mouse") {
      if (!state.mouseMoved && Math.hypot(dx, dy) < MOUSE_SLOP) return;
      state.mouseMoved = true;
      if (!layout || state.base.scale === MIN_ZOOM) return;
      current.setZoom(
        clampZoom(
          {
            scale: state.base.scale,
            x: state.base.x + dx,
            y: state.base.y + dy,
          },
          layout,
        ),
      );
      return;
    }

    if (state.mode === "pinch") {
      const pair = pointerPair(state.pointers);
      if (!state.pinch || !pair || !layout) return;
      current.setZoom(
        rubberBandZoom(
          pinchZoom(
            state.pinch.zoom,
            state.pinch.midpoint,
            state.pinch.distance,
            pair.midpoint,
            pair.distance,
            layout,
          ),
          layout,
        ),
      );
      return;
    }

    state.samples.push({ ...point, t: Date.now() });
    if (state.samples.length > 8) state.samples.shift();

    if (state.mode === "pending") {
      if (Math.hypot(dx, dy) <= TOUCH_SLOP) return;
      // 판정에 쓴 거리는 버리고 여기서부터 따라간다. 그래야 문턱을 넘는 순간 이미지가 튀지 않는다.
      state.start = point;
      if (current.zoom.scale > MIN_ZOOM) {
        state.mode = "pan";
        state.base = current.zoom;
      } else if (Math.abs(dx) > Math.abs(dy)) {
        state.mode = "slide";
        state.base = { ...IDENTITY, x: current.offset };
      } else {
        state.mode = "dismiss";
      }
      return;
    }

    if (state.mode === "slide") {
      const width = current.pageWidth;
      current.setTrack(
        rubberBand(
          state.base.x + dx,
          options.canPage(1) ? -width : 0,
          options.canPage(-1) ? width : 0,
        ),
      );
      return;
    }

    if (state.mode === "dismiss") {
      const height = layout?.viewport.height ?? window.innerHeight;
      current.setDismiss(
        { x: dx, y: dy },
        Math.min(1, Math.abs(dy) / (height * 0.6)),
      );
      return;
    }

    if (state.mode === "pan" && layout) {
      current.setZoom(
        rubberBandZoom(
          {
            scale: state.base.scale,
            x: state.base.x + dx,
            y: state.base.y + dy,
          },
          layout,
        ),
      );
    }
  };

  const finishSlide = (cancelled: boolean) => {
    const current = motion.current;
    const width = current.pageWidth;
    const moved = current.offset;
    const speed = velocity(gesture.current.samples).x;
    // 트랙이 놓인 자리를 "장" 단위로 환산한다. 0.3이면 다음 장 쪽으로 30% 와 있다.
    const position = width === 0 ? 0 : -moved / width;
    let target = Math.round(position);
    if (!cancelled && Math.abs(speed) > FLICK_VELOCITY) {
      target = speed < 0 ? Math.ceil(position) : Math.floor(position);
    } else if (
      !cancelled &&
      Math.abs(moved) > Math.min(PAGE_DISTANCE, width * PAGE_DISTANCE_RATIO)
    ) {
      target = moved < 0 ? Math.ceil(position) : Math.floor(position);
    }

    const direction = clamp(target, -1, 1);
    if (direction !== 0 && options.canPage(direction as -1 | 1)) {
      options.onPage(direction as -1 | 1);
      return;
    }
    current.setTrack(0, SLIDE_MS);
  };

  const finishDismiss = (cancelled: boolean) => {
    const current = motion.current;
    const height = getLayout()?.viewport.height ?? window.innerHeight;
    const { x, y } = current.dismiss;
    const speed = velocity(gesture.current.samples).y;
    const shouldClose =
      !cancelled &&
      (Math.abs(y) > height * DISMISS_DISTANCE_RATIO ||
        (Math.abs(speed) > DISMISS_VELOCITY &&
          Math.sign(speed) === Math.sign(y)));

    if (!shouldClose) {
      current.setDismiss(NO_OFFSET, 0, SETTLE_MS);
      return;
    }
    // 던진 방향으로 마저 날려 보내고, 그동안 Dialog가 닫히며 흐려진다.
    current.setDismiss({ x, y: (Math.sign(y) || 1) * height }, 1, DISMISS_MS);
    options.onDismiss();
  };

  const finishPan = () => {
    const layout = getLayout();
    if (!layout) return;
    const current = motion.current;
    const speed = velocity(gesture.current.samples);
    zoomTo(
      clampZoom(
        {
          scale: current.zoom.scale,
          x: current.zoom.x + speed.x * MOMENTUM_DISTANCE,
          y: current.zoom.y + speed.y * MOMENTUM_DISTANCE,
        },
        layout,
      ),
      MOMENTUM_MS,
    );
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const state = gesture.current;
    if (!state.pointers.has(event.pointerId)) return;
    state.pointers.delete(event.pointerId);

    const cancelled = event.type === "pointercancel";
    const point = toLocal(event);
    const layout = getLayout();
    const current = motion.current;
    const mode = state.mode;

    if (mode === "pinch") {
      const pair = pointerPair(state.pointers);
      if (pair && pair.distance > 0) {
        state.pinch = { ...pair, zoom: current.zoom };
        return;
      }
      const settled = layout ? clampZoom(current.zoom, layout) : IDENTITY;
      zoomTo(settled, SETTLE_MS);
      // 한 손가락이 남아 있고 확대된 상태라면 그 손가락으로 이어서 옮긴다.
      const [remaining] = Array.from(state.pointers.values());
      if (remaining && settled.scale > MIN_ZOOM) {
        state.mode = "pan";
        state.start = remaining;
        state.base = settled;
        state.samples = [];
      } else {
        state.mode = "idle";
      }
      return;
    }

    if (state.pointers.size > 0) return;
    state.mode = "idle";

    switch (mode) {
      case "mouse":
        if (state.mouseMoved) {
          options.onZoomChange(current.zoom);
          return;
        }
        if (!layout) return;
        // 확대된 상태의 클릭은 어디를 눌렀든 원래 크기로 돌아간다. 1배에서는 이미지 위의 클릭만
        // 확대한다 — 바탕 클릭이 확대하면 아무 데나 누른 것에 화면이 반응한다.
        if (
          current.zoom.scale > MIN_ZOOM ||
          frameContains(layout, current.zoom, point)
        ) {
          toggleZoomAt(point);
        }
        return;
      case "pending":
        if (!cancelled && !state.multiTouch) handleTap(point);
        return;
      case "slide":
        finishSlide(cancelled);
        return;
      case "dismiss":
        finishDismiss(cancelled);
        return;
      case "pan":
        finishPan();
        return;
      default:
        return;
    }
  };

  // React의 onWheel은 passive라 페이지 확대를 막을 수 없다. 트랙패드 핀치는 ctrl+wheel로 온다.
  const handleWheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault();
    const layout = getLayout();
    if (!layout) return;

    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? layout.viewport.height
          : 1;
    const delta = event.deltaY * unit;
    const current = motion.current.zoom;
    const scale = clamp(
      current.scale * Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.002)),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    if (scale === current.scale) return;

    // 휠 한 칸(보통 100px)은 짧게 이어 주고, 트랙패드의 잘게 쪼개진 값은 그대로 따라간다.
    zoomTo(
      clampZoom(zoomAt(current, scale, toLocal(event), layout), layout),
      Math.abs(delta) >= 50 ? 120 : 0,
    );
  });

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [viewport]);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
    zoomBy,
    resetZoom,
  };
}
