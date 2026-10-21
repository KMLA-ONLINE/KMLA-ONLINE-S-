/**
 * 별명 상한(기능 명세 §13.25). 서버 `private.is_valid_conversation_nickname`이 같은 규칙을 글자 수(code point)로
 * 강제하므로, 이모지가 두 칸으로 세이지 않게 `length` 대신 글자 수로 센다.
 */
export const NICKNAME_MAX_LENGTH = 20;

/** 이름을 빈칸처럼 보이게 하거나 글자 방향을 뒤집는 글자. 서버 검사와 같은 목록이다. */
const INVISIBLE_CODE_POINTS = new Set([
  0xad, 0x34f, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180e, 0x2800, 0x3164, 0xfeff,
  0xffa0,
]);
const INVISIBLE_RANGES: [number, number][] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
];
const BLANK_CODE_POINTS = new Set([0x20, 0xa0, 0x3000]);

function codePoints(value: string): number[] {
  return Array.from(value, (char) => char.codePointAt(0) ?? 0);
}

function isInvisible(code: number): boolean {
  return (
    INVISIBLE_CODE_POINTS.has(code) ||
    INVISIBLE_RANGES.some(([start, end]) => code >= start && code <= end)
  );
}

function isBlank(code: number): boolean {
  return BLANK_CODE_POINTS.has(code) || (code >= 0x2000 && code <= 0x200a);
}

/**
 * 앞뒤 공백을 뺀 별명의 문제. 빈 값은 별명을 지우는 것이라 문제가 아니다. 서버가 같은 규칙을 다시 검사하므로 화면에서
 * 미리 알려 주는 용도다.
 */
export function nicknameProblem(
  trimmed: string,
): "too_long" | "invisible" | null {
  if (!trimmed) return null;
  const codes = codePoints(trimmed);
  if (codes.length > NICKNAME_MAX_LENGTH) return "too_long";
  if (codes.some(isInvisible) || codes.every(isBlank)) return "invisible";
  return null;
}
