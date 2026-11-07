import type { MessagePoll } from "~/features/messaging/model/types";

/** 투표 입력 제한(기능 명세 §13.30). 서버 `create_message_poll`이 같은 값을 강제한다. */
export const POLL_QUESTION_MAX = 200;
export const POLL_OPTION_MAX = 100;
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 10;

export interface PollDraft {
  question: string;
  options: string[];
  multiple: boolean;
}

export interface PollDraftErrors {
  question?: string;
  options?: string;
}

/** 앞뒤 공백을 걷고 빈 선택지를 뺀 제출용 초안. */
export function normalizePollDraft(draft: PollDraft): PollDraft {
  return {
    question: draft.question.trim(),
    options: draft.options
      .map((option) => option.trim())
      .filter((option) => option !== ""),
    multiple: draft.multiple,
  };
}

/** 저장 전 안내용 검사. 판정은 서버가 다시 한다. 문제가 없으면 `null`이다. */
export function validatePollDraft(draft: PollDraft): PollDraftErrors | null {
  const { question, options } = normalizePollDraft(draft);
  const errors: PollDraftErrors = {};

  if (question === "") {
    errors.question = "질문을 입력해 주세요.";
  } else if (question.length > POLL_QUESTION_MAX) {
    errors.question = `질문은 최대 ${POLL_QUESTION_MAX}자까지 입력할 수 있습니다.`;
  }

  if (options.length < POLL_OPTIONS_MIN || options.length > POLL_OPTIONS_MAX) {
    errors.options = `선택지를 ${POLL_OPTIONS_MIN}개 이상 ${POLL_OPTIONS_MAX}개 이하로 입력해 주세요.`;
  } else if (options.some((option) => option.length > POLL_OPTION_MAX)) {
    errors.options = `선택지는 최대 ${POLL_OPTION_MAX}자까지 입력할 수 있습니다.`;
  } else if (new Set(options).size !== options.length) {
    errors.options = "같은 선택지를 두 번 넣을 수 없습니다.";
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * 내 선택을 바꾼 뒤의 투표. 서버가 확정하기 전에 화면이 먼저 그린다. 단일 선택은 고른 하나로 바꾸고
 * 빈 배열이면 취소다. 복수 선택은 고른 목록 그대로다.
 */
export function applyPollVote(
  poll: MessagePoll,
  optionIds: string[],
  viewerId: string,
): MessagePoll {
  const chosen = new Set(optionIds);
  return {
    ...poll,
    myOptionIds: poll.options
      .filter(({ id }) => chosen.has(id))
      .map(({ id }) => id),
    options: poll.options.map((option) => {
      const voters = option.voterIds.filter((id) => id !== viewerId);
      if (chosen.has(option.id)) voters.push(viewerId);
      return { ...option, voterIds: voters, count: voters.length };
    }),
  };
}

/** 한 명이라도 고른 사람 수. 복수 선택에서는 같은 사람을 한 번만 센다. */
export function pollVoterCount(poll: MessagePoll): number {
  return new Set(poll.options.flatMap(({ voterIds }) => voterIds)).size;
}

/** 단일 선택 투표에서 선택지를 눌렀을 때 보낼 선택. 이미 고른 것을 다시 누르면 취소다. */
export function nextPollChoice(poll: MessagePoll, optionId: string): string[] {
  const mine = new Set(poll.myOptionIds);
  if (poll.multiple) {
    if (mine.has(optionId)) mine.delete(optionId);
    else mine.add(optionId);
    return [...mine];
  }
  return mine.has(optionId) ? [] : [optionId];
}
