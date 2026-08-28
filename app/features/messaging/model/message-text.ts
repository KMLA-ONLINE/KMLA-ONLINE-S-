export const MESSAGE_MAX_LENGTH = 5000;
export const EMOJI_ONLY_MESSAGE_MAX_LENGTH = 5;

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
