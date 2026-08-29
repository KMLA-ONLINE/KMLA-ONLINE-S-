export const MESSAGE_MAX_LENGTH = 5000;
export const EMOJI_ONLY_MESSAGE_MAX_LENGTH = 5;

export type MessageTextSegment =
  { type: "text"; value: string } | { type: "link"; value: string };

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

export function parseMessageText(value: string): MessageTextSegment[] {
  const segments: MessageTextSegment[] = [];
  let cursor = 0;

  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(value)) !== null) {
    let link = match[0];
    while (link.endsWith(")") && countChar(link, "(") < countChar(link, ")")) {
      link = link.slice(0, -1);
    }
    link = link.replace(TRAILING_PUNCTUATION, "");

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
