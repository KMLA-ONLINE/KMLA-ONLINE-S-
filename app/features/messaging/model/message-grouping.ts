import {
  formatMessageTime,
  messageDayKey,
} from "~/features/messaging/model/message-time";
import type { ConversationMessage } from "~/features/messaging/model/types";

/** 대화 영역에서 메시지 한 건의 자리. 날짜 구분선과 묶음의 처음·끝이다(기능 명세 §13.3). */
export interface MessageThreadSlot {
  startsDay: boolean;
  startsGroup: boolean;
  endsGroup: boolean;
}

/**
 * 메시지마다 날짜 구분선과 묶음 경계를 정한다. 한국 날짜와 표시 시각(분)은 메시지마다 한 번만
 * 포매팅한다. 시간대를 지정한 포매팅은 비싸서, 이웃끼리 비교할 때마다 다시 하면 긴 대화방의 렌더가
 * 눈에 띄게 느려진다.
 */
export function layoutMessageThread(
  messages: readonly ConversationMessage[],
): MessageThreadSlot[] {
  const keys = messages.map(({ sentAt }) => ({
    day: messageDayKey(sentAt),
    time: formatMessageTime(sentAt),
  }));
  const connects = (index: number) => {
    const previous = messages[index - 1];
    const next = messages[index];
    const previousKey = keys[index - 1];
    const nextKey = keys[index];
    if (!previous || !next || !previousKey || !nextKey) return false;
    return (
      !previous.system &&
      !next.system &&
      previous.senderId !== null &&
      previous.senderId === next.senderId &&
      previousKey.day === nextKey.day &&
      previousKey.time === nextKey.time &&
      !next.pinned &&
      // 반응은 말풍선 아래에 붙으므로 그 뒤에서 묶음을 끊는다.
      !previous.reactions?.some(({ count }) => count > 0)
    );
  };
  return messages.map((_, index) => ({
    startsDay: index === 0 || keys[index - 1]?.day !== keys[index]?.day,
    startsGroup: !connects(index),
    endsGroup: !connects(index + 1),
  }));
}
