import { describe, expect, it } from "vitest";

import { isSingleEmoji } from "~/shared/lib/emoji/grapheme";
import { EMOJI_GROUPS, searchEmojis } from "~/shared/lib/emoji/search";

describe("emoji search", () => {
  it("빈 검색어는 고른 분류의 이모지를 순서대로 준다", () => {
    const smileys = searchEmojis("", EMOJI_GROUPS[0].id);
    expect(smileys[0].emoji).toBe("😀");
    expect(smileys.every((entry) => entry.group === EMOJI_GROUPS[0].id)).toBe(
      true,
    );
  });

  it("한글 이름과 태그, 공백 차이를 무시하고 찾는다", () => {
    expect(searchEmojis("따봉").map((entry) => entry.emoji)).toContain("👍");
    expect(searchEmojis("빨간색하트").map((entry) => entry.emoji)).toContain(
      "❤️",
    );
    expect(searchEmojis("+1").map((entry) => entry.emoji)).toContain("👍");
  });

  it("이모지 자체로도 찾는다", () => {
    expect(searchEmojis("🇰🇷").map((entry) => entry.emoji)).toEqual(["🇰🇷"]);
  });

  it("피부색 변형과 구성 요소는 목록에 없다", () => {
    expect(searchEmojis("").some((entry) => entry.emoji === "👍🏽")).toBe(false);
    expect(searchEmojis("").some((entry) => entry.emoji === "🏽")).toBe(false);
  });
});

describe("isSingleEmoji", () => {
  it("이모지 한 덩어리만 참이다", () => {
    for (const value of ["👍", "👍🏽", "❤️", "👨‍👩‍👧‍👦", "🇰🇷", "1️⃣", "🏴󠁧󠁢󠁳󠁣󠁴󠁿"]) {
      expect(isSingleEmoji(value), value).toBe(true);
    }
    for (const value of ["", " ", "a", "1", "👍👍", "👍 ", "é", "한", "©"]) {
      expect(isSingleEmoji(value), JSON.stringify(value)).toBe(false);
    }
  });
});
