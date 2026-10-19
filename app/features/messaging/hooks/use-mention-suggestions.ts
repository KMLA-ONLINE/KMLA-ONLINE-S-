import { useState } from "react";

import {
  mentionQueryAt,
  messageMentionSuggestions,
  typedMentionTrigger,
} from "~/features/messaging/model/message-mentions";
import type { MessageParticipant } from "~/features/messaging/model/types";

/**
 * 작성창의 `@` 후보 목록(기능 명세 §13.22). `@`를 치면 열고, 이어 친 글자로 거르며, 맞는 후보가 없거나 검색어가 끊기면 닫는다.
 * 닫힌 뒤에는 다시 `@`를 쳐야 열린다. 넣는 일은 입력창이 맡고 여기서는 어디부터 무엇으로 찾는지만 든다.
 */
export function useMentionSuggestions({
  participants,
  viewerId,
}: {
  /** 멘션할 수 있는 대화의 참여자. 1:1 대화처럼 멘션이 없으면 `null`이다. */
  participants: MessageParticipant[] | null;
  viewerId: string;
}) {
  const [search, setSearch] = useState<{
    trigger: number;
    query: string;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const suggestions =
    search && participants
      ? messageMentionSuggestions(participants, viewerId, search.query)
      : [];

  /** `trigger`의 `@`부터 캐럿까지로 다시 찾는다. 찾을 수 없거나 맞는 후보가 없으면 닫는다. */
  const searchFrom = (trigger: number, text: string, caret: number) => {
    const query = mentionQueryAt(text, trigger, caret);
    if (
      query === null ||
      !participants ||
      messageMentionSuggestions(participants, viewerId, query).length === 0
    ) {
      setSearch(null);
      return;
    }
    if (query !== search?.query || trigger !== search.trigger) {
      setActiveIndex(0);
    }
    setSearch({ trigger, query });
  };

  return {
    open: suggestions.length > 0,
    suggestions,
    activeIndex: Math.min(activeIndex, Math.max(0, suggestions.length - 1)),
    /** 검색어가 시작하는 `@`의 자리. 고른 멘션이 여기부터 캐럿까지를 바꾼다. */
    trigger: search?.trigger ?? null,
    setActiveIndex,
    /** 값이 바뀐 뒤 부른다. 방금 친 `@`면 새로 열고, 열려 있으면 검색어를 고친다. */
    onTextChange: (previous: string, next: string, caret: number) => {
      if (!participants) return;
      const trigger = typedMentionTrigger(previous, next, caret);
      if (trigger !== null) searchFrom(trigger, next, caret);
      else if (search) searchFrom(search.trigger, next, caret);
    },
    /** 캐럿만 움직였을 때 부른다. `@` 앞으로 가면 닫는다. */
    onCaretMove: (text: string, caret: number) => {
      if (search) searchFrom(search.trigger, text, caret);
    },
    /** 위·아래 화살표. 끝에서 반대쪽 끝으로 돈다. */
    move: (delta: number) => {
      const count = suggestions.length;
      if (count === 0) return;
      setActiveIndex(
        (current) => (Math.min(current, count - 1) + delta + count) % count,
      );
    },
    close: () => {
      setSearch(null);
    },
  };
}
