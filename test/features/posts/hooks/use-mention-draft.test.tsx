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
    avatar_url: null,
  };
}

/** 한 명만 고를 때의 번호. 번호를 못 받으면 null. */
function registerOne(
  register: ReturnType<typeof useMentionDraft>["register"],
  member: MentionCandidate,
  body: string,
): number | null {
  return register([member], body)[0]?.ordinal ?? null;
}

describe("useMentionDraft", () => {
  it("returns an ordinal synchronously and recycles one removed from the body", () => {
    const { result } = renderHook(() => useMentionDraft());
    let first: number | null = null;
    let second: number | null = null;
    let recycled: number | null = null;

    act(() => {
      first = registerOne(result.current.register, candidate(1), "");
      second = registerOne(
        result.current.register,
        candidate(2),
        buildMentionToken("멤버1", first!),
      );
      recycled = registerOne(
        result.current.register,
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
        ordinal = registerOne(result.current.register, candidate(index), body);
      });
      expect(ordinal).toBe(index);
      body += `${buildMentionToken(`멤버${index}`, ordinal!)} `;
    }

    let exhausted: number | null = -1;
    act(() => {
      exhausted = registerOne(result.current.register, candidate(51), body);
    });
    expect(exhausted).toBeNull();

    let duplicate: number | null = null;
    act(() => {
      duplicate = registerOne(result.current.register, candidate(25), body);
    });
    expect(duplicate).toBe(25);
  });

  it("gives each member picked together a distinct ordinal", () => {
    const { result } = renderHook(() => useMentionDraft());
    const body = `${buildMentionToken("멤버1", 1)} `;
    act(() => {
      result.current.register([candidate(1)], "");
    });

    let assigned: { ordinal: number; pubId: string }[] = [];
    act(() => {
      // 이미 부른 멤버1은 쓰던 번호를 돌려받고, 새로 고른 둘은 서로 겹치지 않는다.
      assigned = result.current.register(
        [candidate(2), candidate(1), candidate(3)],
        body,
      );
    });

    expect(assigned.map(({ ordinal, pubId }) => [pubId, ordinal])).toEqual([
      ["member-2", 2],
      ["member-1", 1],
      ["member-3", 3],
    ]);
    expect(result.current.entries).toHaveLength(3);
  });

  it("drops the members picked together once the ordinals run out", () => {
    const { result } = renderHook(() => useMentionDraft());
    let body = "";
    act(() => {
      const members = Array.from({ length: MENTION_LIMIT - 1 }, (_, index) =>
        candidate(index + 1),
      );
      for (const { name, ordinal } of result.current.register(members, body)) {
        body += buildMentionToken(name, ordinal);
      }
    });

    let assigned: { pubId: string }[] = [];
    act(() => {
      assigned = result.current.register(
        [candidate(100), candidate(101)],
        body,
      );
    });
    expect(assigned.map(({ pubId }) => pubId)).toEqual(["member-100"]);
  });
});
