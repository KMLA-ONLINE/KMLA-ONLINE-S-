export const STORY_CONTENT_MIN_LENGTH = 2;
export const STORY_CONTENT_MAX_LENGTH = 100;

export function normalizeStoryContent(value: string): string {
  return value.trim();
}

/**
 * 스토리는 짧은 글 하나가 전부다. 구분이나 유형을 따로 두지 않으므로 이 길이 검사가 곧
 * 등록 가능 여부다(기능 명세 §17.6).
 */
export function isStoryContentValid(value: string): boolean {
  const length = normalizeStoryContent(value).length;

  return (
    length >= STORY_CONTENT_MIN_LENGTH && length <= STORY_CONTENT_MAX_LENGTH
  );
}
