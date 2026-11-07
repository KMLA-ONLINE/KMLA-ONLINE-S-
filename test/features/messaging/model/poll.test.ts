import { describe, expect, it } from "vitest";

import {
  applyPollVote,
  pollVoterCount,
  validatePollDraft,
} from "~/features/messaging/model/poll";
import type { MessagePoll } from "~/features/messaging/model/types";

const poll: MessagePoll = {
  multiple: false,
  closedAt: null,
  options: [
    { id: "a", label: "김밥", count: 1, voterIds: ["x"] },
    { id: "b", label: "라면", count: 0, voterIds: [] },
    { id: "c", label: "돈까스", count: 2, voterIds: ["y", "z"] },
  ],
  myOptionIds: [],
};

describe("validatePollDraft", () => {
  it("accepts a trimmed question with two to ten distinct options", () => {
    expect(
      validatePollDraft({
        question: "  점심 뭐 먹지?  ",
        options: ["김밥", " 라면 ", ""],
        multiple: false,
      }),
    ).toBeNull();
  });

  it("rejects an empty or overlong question", () => {
    expect(
      validatePollDraft({
        question: "  ",
        options: ["a", "b"],
        multiple: false,
      }),
    ).toEqual({ question: "질문을 입력해 주세요." });
    expect(
      validatePollDraft({
        question: "가".repeat(201),
        options: ["a", "b"],
        multiple: false,
      }),
    ).toEqual({ question: "질문은 최대 200자까지 입력할 수 있습니다." });
  });

  it("rejects too few, too many, overlong or duplicate options", () => {
    expect(
      validatePollDraft({
        question: "q",
        options: ["a", " "],
        multiple: false,
      }),
    ).toEqual({ options: "선택지를 2개 이상 10개 이하로 입력해 주세요." });
    expect(
      validatePollDraft({
        question: "q",
        options: Array.from({ length: 11 }, (_, index) => `o${index}`),
        multiple: false,
      }),
    ).toEqual({ options: "선택지를 2개 이상 10개 이하로 입력해 주세요." });
    expect(
      validatePollDraft({
        question: "q",
        options: ["a", "b".repeat(101)],
        multiple: false,
      }),
    ).toEqual({ options: "선택지는 최대 100자까지 입력할 수 있습니다." });
    expect(
      validatePollDraft({
        question: "q",
        options: ["김밥", "김밥 "],
        multiple: false,
      }),
    ).toEqual({ options: "같은 선택지를 두 번 넣을 수 없습니다." });
  });
});

describe("applyPollVote", () => {
  it("replaces the choice in a single-choice poll and cancels on the same option", () => {
    const voted = applyPollVote(poll, ["b"], "me");
    expect(voted.myOptionIds).toEqual(["b"]);
    expect(voted.options.map(({ count }) => count)).toEqual([1, 1, 2]);
    expect(voted.options[1]?.voterIds).toEqual(["me"]);

    const moved = applyPollVote(voted, ["c"], "me");
    expect(moved.options.map(({ count }) => count)).toEqual([1, 0, 3]);

    const cancelled = applyPollVote(moved, [], "me");
    expect(cancelled.myOptionIds).toEqual([]);
    expect(cancelled.options.map(({ count }) => count)).toEqual([1, 0, 2]);
  });

  it("counts distinct voters", () => {
    expect(pollVoterCount(poll)).toBe(3);
    expect(
      pollVoterCount({
        ...poll,
        multiple: true,
        options: [
          { id: "a", label: "a", count: 2, voterIds: ["x", "y"] },
          { id: "b", label: "b", count: 1, voterIds: ["x"] },
        ],
      }),
    ).toBe(2);
  });
});
