import { attachmentKindLabel } from "~/features/messaging/model/attachments";
import { sharedPostOf } from "~/features/messaging/model/shared-post";
import type {
  ConversationSummary,
  MessageAttachmentKind,
} from "~/features/messaging/model/types";
import { mentionPlainText } from "~/features/posts/model/mentions";
import { translate, type Locale } from "~/shared/i18n";

/** 답장 인용에 담는 원문 길이. 서버 `private.message_rows`의 `reply_body`와 같다. */
export const REPLY_PREVIEW_LENGTH = 200;

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
  locale: Locale = "ko",
): string {
  const { lastMessage } = conversation;
  if (!lastMessage) return "";
  const body = previewBody(lastMessage, origin, locale);
  if (lastMessage.senderId && lastMessage.senderId === conversation.viewerId) {
    return translate(locale, "나: {body}", { body });
  }
  if (conversation.type !== "group" || !lastMessage.senderId) return body;

  const sender = conversation.participants.find(
    ({ id }) => id === lastMessage.senderId,
  );
  return sender ? `${sender.name}: ${body}` : body;
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
  locale: Locale = "ko",
): string {
  if (original.deleted) return translate(locale, "삭제된 메시지입니다");
  return previewBody(original, origin, locale);
}

/**
 * 한 줄 미리보기의 본문. 본문 없이 첨부만 있으면 첨부 종류로 부르고 파일 이름은 쓰지 않는다. 게시물
 * 링크 하나뿐인 본문은 카드로 그려지므로 URL 대신 `게시물`로 부른다(기능 명세 §13.21).
 */
function previewBody(
  message: { body: string; attachmentKind?: MessageAttachmentKind | null },
  origin: string,
  locale: Locale,
): string {
  if (sharedPostOf(message, origin))
    return translate(locale, "게시물", undefined, "preview");
  // 서버가 준 미리보기는 이미 글자지만, 화면이 방금 만든 미리보기는 원문일 수 있다.
  return (
    mentionPlainText(message.body) ||
    (message.attachmentKind
      ? attachmentKindLabel(message.attachmentKind, locale)
      : "")
  );
}
