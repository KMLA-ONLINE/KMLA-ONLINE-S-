import { messageDayKey } from "~/features/messaging/model/message-time";
import type { ConversationMessage } from "~/features/messaging/model/types";

/** 앞 항목과 이만큼 벌어지면 새 대화 흐름이다(기능 명세 §13.3). */
export const MESSAGE_SESSION_GAP_MS = 60 * 60_000;

/**
 * 같은 작성자라도 앞 메시지와 이만큼 벌어지면 묶음을 끊는다(기능 명세 §13.3). 시각은 묶음 끝에만
 * 보이므로, 간격 없이 이으면 한참 전 메시지가 마지막 시각을 달고 보인다.
 */
export const MESSAGE_GROUP_GAP_MS = 5 * 60_000;

/** 대화 영역에서 메시지 한 건의 자리. 대화 흐름의 시작과 묶음의 처음·끝이다(기능 명세 §13.3). */
export interface MessageThreadSlot {
  /** 이 메시지 위에 대화 흐름 구분선을 그린다. */
  startsSession: boolean;
  startsGroup: boolean;
  endsGroup: boolean;
}

/**
 * 메시지마다 대화 흐름 구분선과 묶음 경계를 정한다. 한국 날짜는 메시지마다 한 번만 포매팅한다.
 * 시간대를 지정한 포매팅은 비싸서, 이웃끼리 비교할 때마다 다시 하면 긴 대화방의 렌더가 눈에 띄게
 * 느려진다.
 */
export function layoutMessageThread(
  messages: readonly ConversationMessage[],
): MessageThreadSlot[] {
  const days = messages.map(({ sentAt }) => messageDayKey(sentAt));
  const times = messages.map(({ sentAt }) => Date.parse(sentAt));
  // 시스템 메시지도 흐름을 잇는다. 간격만 보지 않고 한국 날짜가 바뀌어도 새 흐름으로 연다. 시각을
  // 읽지 못하면 앞 메시지와 이어 붙이지 않는다.
  const startsSession = messages.map((_, index) => {
    if (index === 0 || days[index - 1] !== days[index]) return true;
    const gap = (times[index] ?? NaN) - (times[index - 1] ?? NaN);
    return !(gap < MESSAGE_SESSION_GAP_MS);
  });
  const connects = (index: number) => {
    const previous = messages[index - 1];
    const next = messages[index];
    if (!previous || !next || startsSession[index]) return false;
    const gap = (times[index] ?? NaN) - (times[index - 1] ?? NaN);
    return (
      gap < MESSAGE_GROUP_GAP_MS &&
      !previous.system &&
      !next.system &&
      previous.senderId !== null &&
      previous.senderId === next.senderId &&
      !next.pinned &&
      // 반응은 말풍선 아래에 붙으므로 그 뒤에서 묶음을 끊는다.
      !previous.reactions?.some(({ count }) => count > 0)
    );
  };
  return messages.map((_, index) => ({
    startsSession: startsSession[index] ?? true,
    startsGroup: !connects(index),
    endsGroup: !connects(index + 1),
  }));
}
