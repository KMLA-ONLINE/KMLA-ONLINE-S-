import { isSafePostLink } from "~/features/posts/model/markdown";

/** 기능 명세 §9.1. 게시물 본문과 달리 댓글은 Markdown이 아니라 Unicode 평문이다. */
export const COMMENT_MAX_LENGTH = 5000;

export type CommentSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string }
  | { type: "break" };

/**
 * 저장 직전 정규화.
 *
 * CRLF를 LF로 맞추고 앞뒤 공백만 덜어낸다. 본문 중간의 빈 줄은 사용자가 의도한 간격이므로
 * 건드리지 않는다 — 데이터베이스도 `btrim`만 하므로 양쪽 규칙이 같다.
 */
export function normalizeCommentBody(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

/**
 * 글자 수는 grapheme cluster 기준이다. 이모지 하나가 코드 유닛 여러 개인데 그걸 여러 글자로
 * 세면 사용자가 보는 길이와 어긋난다. 데이터베이스는 `char_length`로 세므로 두 값이 다를 수
 * 있지만, 클라이언트 검사는 UX용이고 실제 경계는 RPC가 잡는다.
 */
let graphemeSegmenter: Intl.Segmenter | null | undefined;

/** 생성 비용이 있는 객체다. 글자 수는 입력 한 글자마다 다시 세므로 한 번 만들어 재사용한다. */
function getGraphemeSegmenter(): Intl.Segmenter | null {
  if (graphemeSegmenter === undefined) {
    graphemeSegmenter =
      typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter("ko", { granularity: "grapheme" })
        : null;
  }
  return graphemeSegmenter;
}

export function countCommentGraphemes(value: string): number {
  const segmenter = getGraphemeSegmenter();
  if (segmenter) {
    let count = 0;
    for (const _ of segmenter.segment(value)) count += 1;
    return count;
  }
  return Array.from(value).length;
}

/** 등록 가능한 본문이면 `null`, 아니면 사용자에게 보여줄 이유를 돌려준다. */
export function validateCommentBody(value: string): string | null {
  const normalized = normalizeCommentBody(value);
  if (!normalized) return "댓글 내용을 입력해 주세요.";
  if (countCommentGraphemes(normalized) > COMMENT_MAX_LENGTH)
    return `댓글은 ${COMMENT_MAX_LENGTH.toLocaleString("ko-KR")}자까지 쓸 수 있습니다.`;
  return null;
}

const URL_PATTERN = /https?:\/\/[^\s]+/gi;

/**
 * URL 뒤에 따라붙은 문장 부호는 링크에서 뗀다. "자세히는 https://example.com/a. 여기서"의
 * 마침표까지 링크에 넣으면 눌렀을 때 다른 주소로 간다.
 */
const TRAILING_PUNCTUATION = /[.,!?;:'"]+$/;

function splitTrailingPunctuation(match: string): [string, string] {
  let link = match;
  // 괄호는 짝이 맞을 때만 URL의 일부다.
  while (link.endsWith(")") && countChar(link, "(") < countChar(link, ")")) {
    link = link.slice(0, -1);
  }
  link = link.replace(TRAILING_PUNCTUATION, "");
  return [link, match.slice(link.length)];
}

function countChar(value: string, char: string): number {
  let count = 0;
  for (const item of value) if (item === char) count += 1;
  return count;
}

/**
 * 읽기 전용 렌더링용 분해.
 *
 * 평문을 Markdown이나 HTML로 해석하지 않는다. 줄바꿈과 http(s) URL만 알아보고 나머지는 입력
 * 순서 그대로 텍스트로 남긴다(콘텐츠 서식 설계 §7.3).
 */
export function parseCommentText(value: string): CommentSegment[] {
  const segments: CommentSegment[] = [];
  const lines = value.replace(/\r\n?/g, "\n").split("\n");

  lines.forEach((line, index) => {
    if (index > 0) segments.push({ type: "break" });

    let cursor = 0;
    URL_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = URL_PATTERN.exec(line)) !== null) {
      const [link, trailing] = splitTrailingPunctuation(match[0]);
      if (!isSafePostLink(link)) continue;
      if (match.index > cursor) {
        segments.push({ type: "text", value: line.slice(cursor, match.index) });
      }
      segments.push({ type: "link", value: link });
      if (trailing) segments.push({ type: "text", value: trailing });
      cursor = match.index + match[0].length;
    }
    if (cursor < line.length) {
      segments.push({ type: "text", value: line.slice(cursor) });
    }
  });

  return segments;
}
