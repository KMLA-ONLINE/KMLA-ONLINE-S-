export const STORY_CONTENT_MIN_LENGTH = 1;
export const STORY_CONTENT_MAX_LENGTH = 100;

export function normalizeStoryContent(value: string): string {
  return value.trim();
}

/**
 * 스토리는 짧은 글 하나가 전부다. 구분이나 유형을 따로 두지 않으므로 이 길이 검사가 곧
 * 등록 가능 여부다(기능 명세 §17.6).
 *
 * 길이는 공백을 제거한 뒤에 센다. 공백만 적은 스토리는 레일에서 빈 칸으로 보이므로 올릴 수
 * 없어야 한다. 비우는 것은 등록이 아니라 삭제로 한다.
 */
export function isStoryContentValid(value: string): boolean {
  const length = normalizeStoryContent(value).length;

  return (
    length >= STORY_CONTENT_MIN_LENGTH && length <= STORY_CONTENT_MAX_LENGTH
  );
}
