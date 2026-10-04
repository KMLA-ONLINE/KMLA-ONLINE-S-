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
 * `undefined`다. `://`가 없으면 스킴을 생략한 것으로 보고 https를 붙인다 — `example.com:8080`의
 * 콜론을 스킴으로 오인하지 않으려는 것이다.
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
      trimmed.includes("://") ? trimmed : `https://${trimmed}`,
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
