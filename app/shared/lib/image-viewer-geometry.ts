/**
 * 이미지 뷰어의 맞춤·확대·이동 계산. DOM을 모르는 순수 함수만 둔다.
 *
 * 좌표는 모두 뷰포트(제스처를 받는 전체화면 영역)의 왼쪽 위를 원점으로 한 px이다. 변형은 이미지
 * 틀의 가운데를 원점으로 `translate(x, y) scale(scale)`을 뜻한다.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface ZoomTransform extends Point {
  scale: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
export const IDENTITY: ZoomTransform = { scale: 1, x: 0, y: 0 };

/** 한계를 넘겨 끌 때 손가락을 따라오는 비율. */
const RUBBER_BAND = 0.3;

/**
 * 1배일 때 이미지 틀이 놓이는 기하.
 *
 * `center`가 뷰포트 가운데와 다를 수 있다. 넓은 화면은 조작부 자리를 비워 두고 그 안쪽 가운데에
 * 이미지를 놓는데, 확대하면 그 비워 둔 자리까지 이미지가 쓴다.
 */
export interface FrameLayout {
  viewport: Size;
  center: Point;
  frame: Size;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * `content`의 비율을 지키며 `box` 안에 들어가는 가장 큰 크기. `maxScale`은 원본 픽셀보다
 * 크게 늘리지 않으려는 상한이다(1이면 원래 크기까지만).
 */
export function fitSize(content: Size, box: Size, maxScale = 1): Size {
  if (
    content.width <= 0 ||
    content.height <= 0 ||
    box.width <= 0 ||
    box.height <= 0
  ) {
    return { width: 0, height: 0 };
  }

  const ratio = Math.min(
    maxScale,
    box.width / content.width,
    box.height / content.height,
  );
  return { width: content.width * ratio, height: content.height * ratio };
}

/**
 * 한 축에서 허용하는 이동 범위.
 *
 * 확대한 틀이 뷰포트보다 작으면 제자리에 두되 뷰포트를 벗어나는 만큼만 민다. 크면 가장자리에
 * 빈 바탕이 드러나지 않는 데까지 움직인다.
 */
function axisBounds(
  viewport: number,
  center: number,
  length: number,
): [number, number] {
  const half = length / 2;
  if (length <= viewport) {
    const settled = clamp(0, half - center, viewport - half - center);
    return [settled, settled];
  }
  return [viewport - half - center, half - center];
}

export function panBounds(layout: FrameLayout, scale: number) {
  return {
    x: axisBounds(
      layout.viewport.width,
      layout.center.x,
      layout.frame.width * scale,
    ),
    y: axisBounds(
      layout.viewport.height,
      layout.center.y,
      layout.frame.height * scale,
    ),
  };
}

/** 손을 뗐을 때 돌아가야 할 자리. 배율과 이동을 모두 한계 안으로 넣는다. */
export function clampZoom(
  zoom: ZoomTransform,
  layout: FrameLayout,
): ZoomTransform {
  const scale = clamp(zoom.scale, MIN_ZOOM, MAX_ZOOM);
  if (scale === MIN_ZOOM) return IDENTITY;

  const bounds = panBounds(layout, scale);
  return {
    scale,
    x: clamp(zoom.x, ...bounds.x),
    y: clamp(zoom.y, ...bounds.y),
  };
}

export function rubberBand(value: number, min: number, max: number): number {
  if (value < min) return min + (value - min) * RUBBER_BAND;
  if (value > max) return max + (value - max) * RUBBER_BAND;
  return value;
}

/**
 * 손가락이 붙어 있는 동안의 자리. 한계를 넘어도 막지 않고 저항만 준다 — 딱 멈추면 제스처가
 * 고장 난 것처럼 느껴진다. 손을 떼면 `clampZoom`으로 되돌아간다.
 */
export function rubberBandZoom(
  zoom: ZoomTransform,
  layout: FrameLayout,
): ZoomTransform {
  const scale =
    zoom.scale > MAX_ZOOM
      ? MAX_ZOOM * (zoom.scale / MAX_ZOOM) ** 0.25
      : zoom.scale < MIN_ZOOM
        ? MIN_ZOOM * (zoom.scale / MIN_ZOOM) ** 0.5
        : zoom.scale;
  const bounds = panBounds(layout, Math.max(MIN_ZOOM, scale));
  return {
    scale,
    x: rubberBand(zoom.x, ...bounds.x),
    y: rubberBand(zoom.y, ...bounds.y),
  };
}

/** `point` 아래의 이미지 지점을 그대로 둔 채 배율만 바꾼다. */
export function zoomAt(
  zoom: ZoomTransform,
  scale: number,
  point: Point,
  layout: FrameLayout,
): ZoomTransform {
  const ratio = scale / zoom.scale;
  return {
    scale,
    x: point.x - layout.center.x - (point.x - layout.center.x - zoom.x) * ratio,
    y: point.y - layout.center.y - (point.y - layout.center.y - zoom.y) * ratio,
  };
}

/**
 * 두 손가락 확대. 시작할 때 두 손가락 가운데 있던 이미지 지점이 지금의 가운데를 따라간다.
 * 그래서 벌리는 동안 옮겨도 같은 제스처 안에서 이동까지 된다.
 */
export function pinchZoom(
  start: ZoomTransform,
  startMidpoint: Point,
  startDistance: number,
  midpoint: Point,
  distance: number,
  layout: FrameLayout,
): ZoomTransform {
  const scale = start.scale * (distance / startDistance);
  const ratio = scale / start.scale;
  return {
    scale,
    x:
      midpoint.x -
      layout.center.x -
      (startMidpoint.x - layout.center.x - start.x) * ratio,
    y:
      midpoint.y -
      layout.center.y -
      (startMidpoint.y - layout.center.y - start.y) * ratio,
  };
}

/** 지금 그려진 이미지가 `point`를 덮는가. 마우스 클릭이 이미지인지 바탕인지 가른다. */
export function frameContains(
  layout: FrameLayout,
  zoom: ZoomTransform,
  point: Point,
): boolean {
  const halfWidth = (layout.frame.width * zoom.scale) / 2;
  const halfHeight = (layout.frame.height * zoom.scale) / 2;
  const centerX = layout.center.x + zoom.x;
  const centerY = layout.center.y + zoom.y;
  return (
    Math.abs(point.x - centerX) <= halfWidth &&
    Math.abs(point.y - centerY) <= halfHeight
  );
}
