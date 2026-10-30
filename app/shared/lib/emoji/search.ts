// 이모지 목록은 `scripts/build-emoji-data.mjs`가 emojibase에서 만든 정적 데이터다. 200KB라
// 이 모듈을 쓰는 화면(이모지 선택창)만 lazy로 불러온다. 다른 곳에서는 `grapheme.ts`만 쓴다.
import data from "./emoji-data.json";

export interface EmojiGroup {
  id: number;
  label: string;
}

export interface EmojiEntry {
  emoji: string;
  label: string;
  group: number;
  tags: readonly string[];
}

export const EMOJI_GROUPS: readonly EmojiGroup[] = data.groups;

/** 대소문자와 공백을 무시한다 — "빨간색 하트"를 "빨간색하트"로 쳐도 찾히게. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

const ENTRIES: readonly EmojiEntry[] = data.emojis.map((entry) => ({
  emoji: entry.u,
  label: entry.l,
  group: entry.g,
  tags: "t" in entry && entry.t ? entry.t : [],
}));

// 검색할 글자는 한 번만 정규화해 둔다. 키를 칠 때마다 1,900개 이름과 태그를 다시 다듬지 않는다.
const HAYSTACKS: readonly string[] = ENTRIES.map((entry) =>
  [entry.label, ...entry.tags].map(normalize).join("\u0000"),
);

/**
 * 검색어가 비어 있으면 분류(`group`)의 이모지를 표준 순서대로, 검색어가 있으면 분류와 상관없이 이름·태그에
 * 검색어가 들어가는 이모지를 준다. 이모지 자체를 붙여 넣어도 찾는다.
 */
export function searchEmojis(
  query: string,
  group?: number,
): readonly EmojiEntry[] {
  const needle = normalize(query);
  if (!needle) {
    return group === undefined
      ? ENTRIES
      : ENTRIES.filter((entry) => entry.group === group);
  }
  const exact = query.trim();
  return ENTRIES.filter(
    (entry, index) =>
      entry.emoji === exact || HAYSTACKS[index].includes(needle),
  );
}
