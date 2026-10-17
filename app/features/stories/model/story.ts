export const STORY_CONTENT_MAX_LENGTH = 100;

/** 한 장이 화면에 머무는 시간. 끝나면 다음 장으로 넘어간다. */
export const STORY_DURATION_MS = 7_000;

/**
 * 글 스토리의 배경. 키는 DB check 제약(`stories_background_check`)과 같아야 한다.
 */
export const STORY_BACKGROUNDS = {
  blue: "bg-gradient-to-br from-sky-500 to-blue-700",
  purple: "bg-gradient-to-br from-violet-500 to-purple-800",
  pink: "bg-gradient-to-br from-pink-400 to-rose-600",
  orange: "bg-gradient-to-br from-amber-400 to-orange-600",
  green: "bg-gradient-to-br from-emerald-400 to-teal-700",
  dark: "bg-gradient-to-br from-zinc-700 to-zinc-950",
} as const;

export type StoryBackground = keyof typeof STORY_BACKGROUNDS;

export const STORY_BACKGROUND_KEYS = Object.keys(
  STORY_BACKGROUNDS,
) as StoryBackground[];

export function isStoryBackground(value: unknown): value is StoryBackground {
  return typeof value === "string" && value in STORY_BACKGROUNDS;
}

export function normalizeStoryContent(value: string): string {
  return value.trim();
}

/**
 * 글 스토리는 글이 곧 내용이라 비울 수 없고, 사진 스토리의 글은 선택이다. 길이는 공백을
 * 제거한 뒤에 센다(기능 명세 §17.6).
 */
export function isStoryContentValid(
  value: string,
  { required }: { required: boolean },
): boolean {
  const length = normalizeStoryContent(value).length;

  return length >= (required ? 1 : 0) && length <= STORY_CONTENT_MAX_LENGTH;
}

/**
 * 입력한 링크를 저장할 모양으로 바꾼다. 비어 있으면 `null`(링크 없음), 쓸 수 없는 값이면
 * `undefined`다. 맨 앞에 `스킴://`이 없으면 스킴을 생략한 것으로 보고 https를 붙인다 —
 * `example.com:8080`의 콜론이나 `web.archive.org/web/https://…`처럼 경로 안의 `://`를 스킴으로
 * 오인하지 않으려는 것이다.
 *
 * 돌려주는 값은 `URL.href`다. 스킴과 호스트가 소문자가 되어 DB check(`^https?://`)와 판정이
 * 어긋나지 않는다.
 */
export function normalizeStoryLink(value: string): string | null | undefined {
  const trimmed = value.trim();

  if (!trimmed) return null;
  if (/\s/.test(trimmed)) return undefined;

  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );

    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    // `mailto:a@b.com`에 https를 붙이면 사용자 정보가 든 b.com 주소가 된다.
    if (url.username || url.password) return undefined;
    if (!url.hostname.includes(".")) return undefined;
    if (url.href.length > 2048) return undefined;

    return url.href;
  } catch {
    return undefined;
  }
}

export function getStoryLinkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export interface StoryAuthorGroup<T extends { pubId: string }> {
  pubId: string;
  stories: T[];
}

/**
 * 목록 RPC가 이미 작성자 순서와 작성자 안의 순서로 정렬해 준다. 여기서는 순서를 바꾸지
 * 않고 연속한 행만 묶는다. 보는 사람 자신의 묶음은 Facebook처럼 맨 앞에 둔다.
 */
export function groupStoriesByAuthor<T extends { pubId: string }>(
  stories: readonly T[],
  viewerPubId: string,
): StoryAuthorGroup<T>[] {
  const groups: StoryAuthorGroup<T>[] = [];

  for (const story of stories) {
    const last = groups.at(-1);

    if (last?.pubId === story.pubId) last.stories.push(story);
    else groups.push({ pubId: story.pubId, stories: [story] });
  }

  const mineIndex = groups.findIndex((group) => group.pubId === viewerPubId);

  if (mineIndex > 0) groups.unshift(...groups.splice(mineIndex, 1));

  return groups;
}

/** 누르고 있는 동안은 멈춘다. 이보다 짧게 눌렀다 떼면 탭으로 본다. */
export const STORY_HOLD_THRESHOLD_MS = 250;

/** 손가락이 이보다 덜 움직였으면 탭이다. 더 움직였으면 쓸기 시도라서 장을 넘기지 않는다. */
const STORY_TAP_SLOP_PX = 10;

/** 화면을 위나 아래로 이만큼 쓸고 떼면 뷰어를 닫는다. */
export const STORY_SWIPE_CLOSE_DISTANCE_PX = 80;

/** 옆으로 이만큼 쓸고 떼면 다음이나 이전 작성자로 건너뛴다. */
export const STORY_SWIPE_AUTHOR_DISTANCE_PX = 60;

export type StoryGesture =
  | { kind: "tap"; side: "previous" | "next" }
  | { kind: "author"; direction: "previous" | "next" }
  | { kind: "close" }
  | { kind: "none" };

/**
 * 뷰어에서 누르고 뗀 한 번을 동작으로 읽는다. 탭은 그 작성자 안에서 장을 넘기고(왼쪽 3분의 1은
 * 이전), 옆으로 쓸면 작성자를 건너뛴다(왼쪽으로 쓸면 다음). 쓸기는 걸린 시간과 상관없이 이동
 * 거리로만 판정한다. 시간으로 먼저 가르면 빠른 쓸기가 탭이 되어 장이 넘어간다.
 */
export function readStoryGesture({
  dx,
  dy,
  durationMs,
  x,
  width,
}: {
  dx: number;
  dy: number;
  durationMs: number;
  /** 카드 왼쪽 끝에서 뗀 자리까지의 거리. */
  x: number;
  width: number;
}): StoryGesture {
  const horizontal = Math.abs(dx) > Math.abs(dy);

  if (!horizontal && Math.abs(dy) >= STORY_SWIPE_CLOSE_DISTANCE_PX) {
    return { kind: "close" };
  }
  if (horizontal && Math.abs(dx) >= STORY_SWIPE_AUTHOR_DISTANCE_PX) {
    return { kind: "author", direction: dx < 0 ? "next" : "previous" };
  }
  if (Math.max(Math.abs(dx), Math.abs(dy)) > STORY_TAP_SLOP_PX) {
    return { kind: "none" };
  }
  if (durationMs > STORY_HOLD_THRESHOLD_MS) return { kind: "none" };

  return { kind: "tap", side: x < width / 3 ? "previous" : "next" };
}

export type StoryAuthorJump =
  { kind: "show"; id: number } | { kind: "close" } | { kind: "stay" };

/**
 * 옆으로 쓸었을 때 갈 곳. Facebook처럼 이웃 작성자의 첫 장으로 간다. 마지막 작성자에서 더 넘기면
 * 볼 것이 없으니 닫고, 첫 작성자에서 되돌리면 그 자리에 둔다.
 */
export function findAuthorJump<T extends { pubId: string; id: number }>(
  groups: readonly StoryAuthorGroup<T>[],
  groupIndex: number,
  direction: "previous" | "next",
): StoryAuthorJump {
  const target = groups[groupIndex + (direction === "next" ? 1 : -1)];
  const first = target?.stories[0];

  if (first) return { kind: "show", id: first.id };

  return direction === "next" ? { kind: "close" } : { kind: "stay" };
}

/**
 * 글이나 링크를 캔버스 어디에 얼마나 크게 놓았는지. `x`·`y`는 9:16 캔버스 안의 0~1 비율 좌표로
 * 요소의 중심이고, `scale`은 기본 크기에 대한 배율이다. 범위는 DB check(`is_story_layout`)와
 * 같아야 한다.
 */
export interface StoryPlacement {
  x: number;
  y: number;
  scale: number;
}

/** 키가 없는 요소는 예전처럼 기본 자리에 그린다. 위치 편집 전에 올린 스토리가 그렇다. */
export interface StoryLayout {
  text?: StoryPlacement;
  link?: StoryPlacement;
}

export type StoryLayoutElement = keyof StoryLayout;

export const STORY_SCALE_MIN = 0.5;
export const STORY_SCALE_MAX = 2.5;

/** 작성 창이 처음 놓는 자리. 사진 위 글은 사진을 가리지 않게 아래쪽에 둔다. */
export function defaultStoryPlacement(
  element: StoryLayoutElement,
  { overlay }: { overlay: boolean },
): StoryPlacement {
  if (element === "link") return { x: 0.5, y: 0.88, scale: 1 };

  return { x: 0.5, y: overlay ? 0.74 : 0.5, scale: 1 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** jsonb로 저장해도 길어지지 않게 자른다. 화면에서 구분되지 않는 차이다. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function clampPlacement({ x, y, scale }: StoryPlacement): StoryPlacement {
  return {
    x: round(clamp(x, 0, 1)),
    y: round(clamp(y, 0, 1)),
    scale: round(clamp(scale, STORY_SCALE_MIN, STORY_SCALE_MAX)),
  };
}

/** 중심이 캔버스를 벗어나지 않게 끈다. `dx`·`dy`는 캔버스 폭·높이에 대한 비율이다. */
export function moveStoryPlacement(
  placement: StoryPlacement,
  dx: number,
  dy: number,
): StoryPlacement {
  return clampPlacement({
    ...placement,
    x: placement.x + dx,
    y: placement.y + dy,
  });
}

export function scaleStoryPlacement(
  placement: StoryPlacement,
  factor: number,
): StoryPlacement {
  return clampPlacement({ ...placement, scale: placement.scale * factor });
}

function isPlacement(value: unknown): value is StoryPlacement {
  if (typeof value !== "object" || value === null) return false;

  const keys = Object.keys(value);
  const { x, y, scale } = value as Record<string, unknown>;

  return (
    keys.every((key) => key === "x" || key === "y" || key === "scale") &&
    typeof x === "number" &&
    typeof y === "number" &&
    typeof scale === "number" &&
    x >= 0 &&
    x <= 1 &&
    y >= 0 &&
    y <= 1 &&
    scale >= STORY_SCALE_MIN &&
    scale <= STORY_SCALE_MAX
  );
}

/** 목록 RPC의 `layout`을 읽는다. DB가 이미 지키는 모양이지만 틀리면 기본 자리로 그린다. */
export function parseStoryLayout(value: unknown): StoryLayout | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const layout: StoryLayout = {};

  for (const [key, placement] of Object.entries(value)) {
    if ((key !== "text" && key !== "link") || !isPlacement(placement)) {
      return null;
    }
    layout[key] = placement;
  }

  return layout.text || layout.link ? layout : null;
}

/** 저장할 레이아웃. 없는 글이나 링크의 자리는 DB가 거절하므로 뺀다. */
export function buildStoryLayout(
  placements: Required<StoryLayout>,
  { hasText, hasLink }: { hasText: boolean; hasLink: boolean },
): StoryLayout | null {
  const layout: StoryLayout = {};

  if (hasText) layout.text = placements.text;
  if (hasLink) layout.link = placements.link;

  return layout.text || layout.link ? layout : null;
}
