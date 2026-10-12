import { attachmentKindLabel } from "~/features/messaging/model/attachments";
import type {
  ConversationSummary,
  MessageAttachmentKind,
} from "~/features/messaging/model/types";

/** 대화 목록의 마지막 메시지 한 줄. 그룹 대화에서 남이 보낸 메시지에는 발신자 이름을 붙인다. */
export function formatLastMessagePreview(
  conversation: Pick<
    ConversationSummary,
    "type" | "participants" | "viewerId" | "lastMessage"
  >,
): string {
  const { lastMessage } = conversation;
  if (!lastMessage) return "";
  // 본문 없이 첨부만 있으면 첨부 종류로 부른다. 파일 이름은 쓰지 않는다.
  const body =
    lastMessage.body ||
    (lastMessage.attachmentKind
      ? attachmentKindLabel(lastMessage.attachmentKind)
      : "");
  if (
    conversation.type !== "group" ||
    !lastMessage.senderId ||
    lastMessage.senderId === conversation.viewerId
  ) {
    return body;
  }

  const sender = conversation.participants.find(
    ({ id }) => id === lastMessage.senderId,
  );
  return sender ? `${sender.name}: ${body}` : body;
}

/**
 * 답장 인용과 작성창 답장 표시의 원문 한 줄. 본문 없이 첨부만 있는 원문은 첨부 종류로 부른다.
 * 삭제된 원문은 원문 대신 안내 문구를 쓴다(기능 명세 §13.7).
 */
export function formatReplyPreview(original: {
  body: string;
  deleted?: boolean;
  attachmentKind?: MessageAttachmentKind | null;
}): string {
  if (original.deleted) return "삭제된 메시지입니다";
  return (
    original.body ||
    (original.attachmentKind
      ? attachmentKindLabel(original.attachmentKind)
      : "")
  );
}
