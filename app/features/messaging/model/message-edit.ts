import type { ConversationMessage } from "~/features/messaging/model/types";

/** 보낸 뒤 고칠 수 있는 시간(기능 명세 §13.10). 서버 `edit_message`가 같은 기한을 강제한다. */
export const MESSAGE_EDIT_WINDOW_MS = 15 * 60_000;

/** 메뉴에 `수정`을 보일지. 서버 기한과 시계가 조금 어긋나도 최종 판정은 서버가 한다. */
export function canEditMessage(
  message: ConversationMessage,
  viewerId: string,
  now = Date.now(),
): boolean {
  return (
    message.senderId === viewerId &&
    !message.deleted &&
    !message.pending &&
    !message.system &&
    now - Date.parse(message.sentAt) < MESSAGE_EDIT_WINDOW_MS
  );
}
