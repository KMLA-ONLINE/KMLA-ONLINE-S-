import { mentionTokenPattern } from "~/features/posts/model/mentions";

export const MESSAGE_MAX_LENGTH = 5000;
export const EMOJI_ONLY_MESSAGE_MAX_LENGTH = 5;

export type MessageTextSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string }
  | { type: "mention"; ordinal: number; label: string };

const EMOJI_GRAPHEME_PATTERN =
  /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|(?:\p{Emoji_Presentation}\uFE0F?|\p{Extended_Pictographic}\uFE0F)\p{Emoji_Modifier}?(?:\u200D(?:\p{Emoji_Presentation}\uFE0F?|\p{Extended_Pictographic}\uFE0F)\p{Emoji_Modifier}?)*(?:[\u{E0020}-\u{E007E}]+\u{E007F})?)$/u;

let graphemeSegmenter: Intl.Segmenter | null | undefined;

function getGraphemeSegmenter(): Intl.Segmenter | null {
  if (graphemeSegmenter === undefined) {
    graphemeSegmenter =
      typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter("ko", { granularity: "grapheme" })
        : null;
  }
  return graphemeSegmenter;
}

export function countMessageGraphemes(value: string): number {
  return segmentMessageGraphemes(value).length;
}

function segmentMessageGraphemes(value: string): string[] {
  const segmenter = getGraphemeSegmenter();
  if (!segmenter) return Array.from(value);

  return Array.from(segmenter.segment(value), ({ segment }) => segment);
}

export function getEmojiOnlyMessageGraphemes(value: string): string[] | null {
  const graphemes = segmentMessageGraphemes(value);
  if (
    graphemes.length === 0 ||
    graphemes.length > EMOJI_ONLY_MESSAGE_MAX_LENGTH
  ) {
    return null;
  }

  return graphemes.every((grapheme) => EMOJI_GRAPHEME_PATTERN.test(grapheme))
    ? graphemes
    : null;
}

export function normalizeMessageBody(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
}

const URL_PATTERN = /https?:\/\/[^\s]+/gi;
const TRAILING_PUNCTUATION = /[.,!?;:'"]+$/;

/**
 * 화면에 그릴 조각. 멘션 토큰을 먼저 가르고 그 사이 글자에서만 URL을 찾는다 — 멘션 안이나 멘션에 붙여 친 글자가
 * 링크로 이어지지 않는다.
 */
export function parseMessageText(value: string): MessageTextSegment[] {
  const segments: MessageTextSegment[] = [];
  let cursor = 0;
  for (const match of value.matchAll(mentionTokenPattern())) {
    segments.push(...parseLinks(value.slice(cursor, match.index)));
    segments.push({
      type: "mention",
      ordinal: Number(match[2]),
      label: match[1],
    });
    cursor = match.index + match[0].length;
  }
  segments.push(...parseLinks(value.slice(cursor)));
  return segments;
}

function parseLinks(value: string): MessageTextSegment[] {
  const segments: MessageTextSegment[] = [];
  let cursor = 0;

  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(value)) !== null) {
    // `).`처럼 닫는 괄호와 문장부호가 섞여 끝날 수 있어 둘이 더 안 깎일 때까지 번갈아 깎는다.
    let link = match[0];
    let previous: string;
    do {
      previous = link;
      link = link.replace(TRAILING_PUNCTUATION, "");
      if (link.endsWith(")") && countChar(link, "(") < countChar(link, ")")) {
        link = link.slice(0, -1);
      }
    } while (link !== previous);

    if (match.index > cursor) {
      segments.push({ type: "text", value: value.slice(cursor, match.index) });
    }
    segments.push({ type: "link", value: link });

    const trailing = match[0].slice(link.length);
    if (trailing) segments.push({ type: "text", value: trailing });
    cursor = match.index + match[0].length;
  }

  if (cursor < value.length) {
    segments.push({ type: "text", value: value.slice(cursor) });
  }
  return segments;
}

function countChar(value: string, char: string): number {
  let count = 0;
  for (const item of value) if (item === char) count += 1;
  return count;
}
