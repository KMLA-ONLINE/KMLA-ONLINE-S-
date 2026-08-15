import { describe, expect, it } from "vitest";

import {
  applyReactionLocally,
  DEFAULT_REACTION,
  REACTION_TYPES,
  reactionAssetPath,
  reactionLabel,
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

  it("points every reaction at a bundled Twemoji file", () => {
    for (const type of REACTION_TYPES) {
      expect(reactionAssetPath(type.key)).toBe(
        `/twemoji/15.1.0/${type.codepoint}.svg`,
      );
    }
  });

  it("names the default reaction", () => {
    expect(DEFAULT_REACTION).toBe("like");
    expect(reactionLabel("like")).toBe("좋아요");
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
