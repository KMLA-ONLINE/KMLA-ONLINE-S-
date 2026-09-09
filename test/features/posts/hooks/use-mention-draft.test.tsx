import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useMentionDraft } from "~/features/posts/hooks/use-mention-draft";
import {
  MENTION_LIMIT,
  buildMentionToken,
  type MentionCandidate,
} from "~/features/posts/model/mentions";

function candidate(index: number): MentionCandidate {
  return {
    pub_id: `member-${index}`,
    name: `멤버${index}`,
    cohort: 30,
    is_returning_student: false,
    profile_type: "student",
    avatar_path: null,
  };
}

describe("useMentionDraft", () => {
  it("returns an ordinal synchronously and recycles one removed from the body", () => {
    const { result } = renderHook(() => useMentionDraft());
    let first: number | null = null;
    let second: number | null = null;
    let recycled: number | null = null;

    act(() => {
      first = result.current.register(candidate(1), "");
      second = result.current.register(
        candidate(2),
        buildMentionToken("멤버1", first!),
      );
      recycled = result.current.register(
        candidate(3),
        buildMentionToken("멤버2", second!),
      );
    });

    expect([first, second, recycled]).toEqual([1, 2, 1]);
    expect(result.current.entries).toEqual([
      { ordinal: 2, pubId: "member-2", name: "멤버2" },
      { ordinal: 1, pubId: "member-3", name: "멤버3" },
    ]);
  });

  it("never allocates outside the supported range", () => {
    const { result } = renderHook(() => useMentionDraft());
    let body = "";

    for (let index = 1; index <= MENTION_LIMIT; index += 1) {
      let ordinal: number | null = null;
      act(() => {
        ordinal = result.current.register(candidate(index), body);
      });
      expect(ordinal).toBe(index);
      body += `${buildMentionToken(`멤버${index}`, ordinal!)} `;
    }

    let exhausted: number | null = -1;
    act(() => {
      exhausted = result.current.register(candidate(51), body);
    });
    expect(exhausted).toBeNull();

    let duplicate: number | null = null;
    act(() => {
      duplicate = result.current.register(candidate(25), body);
    });
    expect(duplicate).toBe(25);
  });
});
