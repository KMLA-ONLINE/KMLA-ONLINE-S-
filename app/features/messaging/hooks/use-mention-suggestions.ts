import { useState } from "react";

import {
  mentionQueryAt,
  messageMentionSuggestions,
  typedMentionTrigger,
} from "~/features/messaging/model/message-mentions";
import type { MessageParticipant } from "~/features/messaging/model/types";

interface MentionSearch {
  trigger: number;
  query: string;
  /** 위·아래 화살표로 후보를 옮겼는지. 옮기지 않았고 검색어도 없으면 `Enter`가 고르지 않는다. */
  navigated: boolean;
}

/**
 * 작성창의 `@` 후보 목록. `@`를 치면 열고, 이어 친 글자로 거르며, 맞는 후보가 없거나 검색어가 끊기면 닫는다. 닫힌 뒤에는
 * 다시 `@`를 쳐야 열린다. 넣는 일은 입력창이 맡고 여기서는 어디부터 무엇으로 찾는지만 든다.
 */
export function useMentionSuggestions({
  participants,
  viewerId,
}: {
  /** 멘션할 수 있는 대화의 참여자. 1:1 대화처럼 멘션이 없으면 `null`이다. */
  participants: MessageParticipant[] | null;
  viewerId: string;
}) {
  const [search, setSearch] = useState<MentionSearch | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const suggestions =
    search && participants
      ? messageMentionSuggestions(participants, viewerId, search.query)
      : [];

  /**
   * `trigger`의 `@`부터 캐럿까지로 다시 찾는다. 찾을 수 없거나 맞는 후보가 없으면 닫는다. 다만 한글 조합 중에는 맞는 후보가
   * 없어도 닫지 않고 숨기기만 한다 — `하나`를 치는 동안 잠깐 `한`이 되는 것처럼 조합 중인 글자는 이름과 어긋날 수 있다.
   */
  const searchFrom = (
    trigger: number,
    text: string,
    caret: number,
    composing: boolean,
  ) => {
    const query = mentionQueryAt(text, trigger, caret);
    if (
      query === null ||
      !participants ||
      (!composing &&
        messageMentionSuggestions(participants, viewerId, query).length === 0)
    ) {
      setSearch(null);
      return;
    }
    const sameSearch = query === search?.query && trigger === search.trigger;
    if (!sameSearch) setActiveIndex(0);
    setSearch({
      trigger,
      query,
      navigated: sameSearch && search.navigated,
    });
  };

  return {
    open: suggestions.length > 0,
    suggestions,
    activeIndex: Math.min(activeIndex, Math.max(0, suggestions.length - 1)),
    /** 검색어가 시작하는 `@`의 자리. 고른 멘션이 여기부터 캐럿까지를 바꾼다. */
    trigger: search?.trigger ?? null,
    /**
     * `Enter`가 후보를 고를지. `@`만 치고 아무것도 고르지 않았으면 고르지 않는다 — 글 끝에 `abc@`를 치고 보내려던 `Enter`가
     * 맨 위의 `@모든 사람`을 넣어 대화 전체에 알림을 보내지 않게 한다.
     */
    enterSelects: Boolean(search && (search.query !== "" || search.navigated)),
    setActiveIndex,
    /** 값이 바뀐 뒤 부른다. 방금 친 `@`면 새로 열고, 열려 있으면 검색어를 고친다. */
    onTextChange: (
      previous: string,
      next: string,
      caret: number,
      composing: boolean,
    ) => {
      if (!participants) return;
      const trigger = typedMentionTrigger(previous, next, caret);
      if (trigger !== null) searchFrom(trigger, next, caret, composing);
      else if (search) searchFrom(search.trigger, next, caret, composing);
    },
    /** 캐럿만 움직였거나 한글 조합이 끝났을 때 부른다. `@` 앞으로 가거나 맞는 후보가 없으면 닫는다. */
    onCaretMove: (text: string, caret: number) => {
      if (search) searchFrom(search.trigger, text, caret, false);
    },
    /** 위·아래 화살표. 끝에서 반대쪽 끝으로 돈다. */
    move: (delta: number) => {
      const count = suggestions.length;
      if (count === 0 || !search) return;
      setSearch({ ...search, navigated: true });
      setActiveIndex(
        (current) => (Math.min(current, count - 1) + delta + count) % count,
      );
    },
    close: () => {
      setSearch(null);
    },
  };
}
