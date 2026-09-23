import { describe, expect, it } from "vitest";

import {
  applyReactionLocally,
  DEFAULT_REACTION,
  REACTION_TYPES,
  reactionAssetPath,
} from "~/features/posts/model/reactions";
import type { ReactionSummary } from "~/features/posts/model/types";

const summary = (over: Partial<ReactionSummary> = {}): ReactionSummary => ({
  reaction_count: 3,
  top_reactions: ["like"],
  my_reaction: null,
  ...over,
});

describe("reaction types", () => {
  it("keeps the quick bar in the database enum order", () => {
    // 서버가 같은 수의 상위 반응을 enum 순서로 갈라 내려준다. 여기가 어긋나면 화면과 서버의
    // "많이 쓰인 순"이 달라진다.
    expect(REACTION_TYPES.map((type) => type.key)).toEqual([
      "like",
      "love",
      "haha",
      "wow",
      "sad",
      "angry",
    ]);
  });

  // 자산은 서비스에 직접 담아 서비스 워커가 함께 캐시한다. 외부 CDN을 쓰면 오프라인에서
  // 반응만 빈칸이 된다(`docs/CONTENT_FORMATTING.md` §8.2).
  it("serves reaction graphics from this origin", () => {
    expect(reactionAssetPath(DEFAULT_REACTION)).toMatch(/^\/twemoji\//);
  });
});

describe("applyReactionLocally", () => {
  it("counts a new reaction once", () => {
    expect(applyReactionLocally(summary(), "love")).toMatchObject({
      reaction_count: 4,
      my_reaction: "love",
    });
  });

  it("keeps the total flat when the reaction only changes kind", () => {
    expect(
      applyReactionLocally(summary({ my_reaction: "like" }), "sad"),
    ).toMatchObject({ reaction_count: 3, my_reaction: "sad" });
  });

  it("gives the count back when the reaction is removed", () => {
    expect(
      applyReactionLocally(summary({ my_reaction: "like" }), null),
    ).toMatchObject({ reaction_count: 2, my_reaction: null });
  });

  it("leaves the top reactions to the server", () => {
    // 내 반응 하나로는 남들의 순위를 알 수 없다. 응답이 오면 정본으로 덮인다.
    expect(applyReactionLocally(summary(), "angry").top_reactions).toEqual([
      "like",
    ]);
  });
});
