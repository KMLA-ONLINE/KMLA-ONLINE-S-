export const MESSAGE_MAX_LENGTH = 5000;

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
  const segmenter = getGraphemeSegmenter();
  if (!segmenter) return Array.from(value).length;

  let count = 0;
  for (const _ of segmenter.segment(value)) count += 1;
  return count;
}

export function normalizeMessageBody(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
}
