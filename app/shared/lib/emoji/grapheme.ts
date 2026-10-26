/**
 * grapheme cluster 하나가 이모지인지 판정하는 정규식. 국기(지역 지표 둘), 키캡(`1️⃣`), 피부색·ZWJ로
 * 이어 붙인 가족·직업 이모지, 태그 시퀀스 국기(스코틀랜드 등)까지 한 덩어리로 받는다. `©`처럼
 * 글자 표현이 기본인 기호는 변형 선택자(`️`)가 붙어야 이모지다.
 */
export const EMOJI_GRAPHEME_PATTERN =
  /^(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|(?:\p{Emoji_Presentation}️?|\p{Extended_Pictographic}️)\p{Emoji_Modifier}?(?:‍(?:\p{Emoji_Presentation}️?|\p{Extended_Pictographic}️)\p{Emoji_Modifier}?)*(?:[\u{E0020}-\u{E007E}]+\u{E007F})?)$/u;

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

/** 사용자가 보는 글자 단위로 자른다. `Intl.Segmenter`가 없는 오래된 브라우저는 code point 단위다. */
export function segmentGraphemes(value: string): string[] {
  const segmenter = getGraphemeSegmenter();
  if (!segmenter) return Array.from(value);
  return Array.from(segmenter.segment(value), ({ segment }) => segment);
}

/**
 * 값 전체가 이모지 딱 한 덩어리인지. 메시지 반응은 이 모양만 받는다(기능 명세 §13.8).
 * 정규식이 처음부터 끝까지 한 덩어리만 허용하므로 `Intl.Segmenter`가 없는 브라우저에서도 그대로
 * 판정한다 — code point로 나눠 세면 ❤️·국기·피부색 이모지가 전부 여러 개로 세어져 막힌다.
 */
export function isSingleEmoji(value: string): boolean {
  return EMOJI_GRAPHEME_PATTERN.test(value);
}
