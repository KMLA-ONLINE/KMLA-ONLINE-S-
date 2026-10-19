import { attachmentKindLabel } from "~/features/messaging/model/attachments";
import { sharedPostOf } from "~/features/messaging/model/shared-post";
import type {
  ConversationSummary,
  MessageAttachmentKind,
} from "~/features/messaging/model/types";
import { mentionPlainText } from "~/features/posts/model/mentions";

/** 답장 인용에 담는 원문 길이. 서버 `private.message_rows`의 `reply_body`와 같다. */
export const REPLY_PREVIEW_LENGTH = 200;

/** 대화 목록과 메시지 화면에서 부르는 이름. 1:1은 별명을 우선하고 그룹은 대화 이름을 유지한다. */
export function conversationDisplayName(
  conversation: Pick<
    ConversationSummary,
    "type" | "name" | "viewerId" | "participants"
  >,
): string {
  if (conversation.type !== "direct") return conversation.name;
  const other = conversation.participants.find(
    ({ id }) => id !== conversation.viewerId,
  );
  return (
    other?.nickname ?? other?.name ?? other?.profileName ?? conversation.name
  );
}

/** 대화 밖에서 상대를 찾을 때는 별명 대신 프로필 이름을 쓴다. 그룹 이름은 그대로 둔다. */
export function conversationProfileName(
  conversation: Pick<
    ConversationSummary,
    "type" | "name" | "viewerId" | "participants"
  >,
): string {
  if (conversation.type !== "direct") return conversation.name;
  const other = conversation.participants.find(
    ({ id }) => id !== conversation.viewerId,
  );
  return other?.profileName ?? other?.name ?? conversation.name;
}

/** 답장 인용에 담을 원문 앞부분. 서버처럼 멘션을 `@이름` 글자로 바꾼 뒤 자른다 — 먼저 자르면 토큰이 반쪽 난다. */
export function toReplyPreviewBody(body: string): string {
  return mentionPlainText(body).slice(0, REPLY_PREVIEW_LENGTH);
}

/**
 * 대화 목록의 마지막 메시지 한 줄. 내가 보낸 메시지에는 `나:`를, 그룹 대화에서 남이 보낸 메시지에는
 * 발신자 이름을 붙인다. 1:1 대화의 상대 메시지는 대화 이름이 곧 발신자라 붙이지 않는다.
 */
export function formatLastMessagePreview(
  conversation: Pick<
    ConversationSummary,
    "type" | "participants" | "viewerId" | "lastMessage"
  >,
  origin: string,
): string {
  const { lastMessage } = conversation;
  if (!lastMessage) return "";
  const body = previewBody(lastMessage, origin);
  if (lastMessage.senderId && lastMessage.senderId === conversation.viewerId) {
    return `나: ${body}`;
  }
  if (conversation.type !== "group" || !lastMessage.senderId) return body;

  const sender = conversation.participants.find(
    ({ id }) => id === lastMessage.senderId,
  );
  return sender ? `${sender.nickname ?? sender.name}: ${body}` : body;
}

/**
 * 답장 인용과 작성창 답장 표시의 원문 한 줄. 본문 없이 첨부만 있는 원문은 첨부 종류로 부른다.
 * 삭제된 원문은 원문 대신 안내 문구를 쓴다(기능 명세 §13.7).
 */
export function formatReplyPreview(
  original: {
    body: string;
    deleted?: boolean;
    attachmentKind?: MessageAttachmentKind | null;
  },
  origin: string,
): string {
  if (original.deleted) return "삭제된 메시지입니다";
  return previewBody(original, origin);
}

/**
 * 한 줄 미리보기의 본문. 본문 없이 첨부만 있으면 첨부 종류로 부르고 파일 이름은 쓰지 않는다. 게시물
 * 링크 하나뿐인 본문은 카드로 그려지므로 URL 대신 `게시물`로 부른다(기능 명세 §13.21).
 */
function previewBody(
  message: { body: string; attachmentKind?: MessageAttachmentKind | null },
  origin: string,
): string {
  if (sharedPostOf(message, origin)) return "게시물";
  // 서버가 준 미리보기는 이미 글자지만, 화면이 방금 만든 미리보기는 원문일 수 있다.
  return (
    mentionPlainText(message.body) ||
    (message.attachmentKind ? attachmentKindLabel(message.attachmentKind) : "")
  );
}
