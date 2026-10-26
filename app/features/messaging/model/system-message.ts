import type {
  ConversationSummary,
  MessageParticipant,
  MessageSystemEvent,
} from "~/features/messaging/model/types";
import { translate, type Locale } from "~/shared/i18n";

const UNKNOWN_NAME = "알 수 없는 사용자";

/**
 * 대화 안의 시스템 메시지 문구. 이름은 지금과 예전 멤버 모두에서 찾는다. 별명 변경은 별명이 아니라 프로필 이름으로 쓴다 —
 * 별명으로 쓰면 무엇이 무엇으로 바뀌었는지 알 수 없다(기능 명세 §13.25).
 */
export function formatSystemMessage(
  event: MessageSystemEvent,
  participants: ReadonlyMap<string, MessageParticipant>,
  locale: Locale = "ko",
): string {
  const t = (source: string, params?: Record<string, string>) =>
    translate(locale, source, params);
  const byProfileName =
    event.kind === "nickname_set" || event.kind === "nickname_cleared";
  const nameOf = (id: string | undefined) => {
    const participant = id ? participants.get(id) : undefined;
    return (
      (byProfileName
        ? (participant?.profileName ?? participant?.name)
        : participant?.name) ?? t(UNKNOWN_NAME)
    );
  };
  const [actorId, ...targetIds] = event.profileIds;
  const actor = nameOf(actorId);
  // 호칭(님)은 한국어에만 있어서 이름마다 따로 번역한다.
  const targets = targetIds
    .map((id) => t("{name}님", { name: nameOf(id) }))
    .join(", ");
  const owner =
    targetIds[0] === actorId
      ? t("자신의")
      : t("{name}님의", { name: nameOf(targetIds[0]) });
  const name = event.name ?? "";

  switch (event.kind) {
    case "member_added":
      return t("{actor}님이 {targets}을 초대했습니다.", { actor, targets });
    case "member_left":
      return t("{actor}님이 나갔습니다.", { actor });
    case "member_removed":
      return t("{actor}님이 {targets}을 내보냈습니다.", { actor, targets });
    case "renamed":
      return t("{actor}님이 채팅 이름을 ‘{name}’(으)로 변경했습니다.", {
        actor,
        name,
      });
    case "nickname_set":
      return t("{actor}님이 {owner} 별명을 ‘{name}’(으)로 정했습니다.", {
        actor,
        owner,
        name,
      });
    case "nickname_cleared":
      return t("{actor}님이 {owner} 별명을 지웠습니다.", { actor, owner });
  }
}

/** 지금 멤버만. 멤버 목록과 인원, 읽지 않은 수에 쓴다. */
export function activeParticipants(
  conversation: Pick<ConversationSummary, "participants">,
): MessageParticipant[] {
  return conversation.participants.filter(({ active }) => active);
}

/** 내가 아직 이 대화의 멤버인지. 나갔거나 내보내졌으면 보내기와 멤버 변경을 막는다. */
export function isViewerActive(
  conversation: Pick<ConversationSummary, "participants" | "viewerId">,
): boolean {
  return conversation.participants.some(
    ({ id, active }) => id === conversation.viewerId && active,
  );
}

/** 1:1 대화 상대가 탈퇴했는지. 대화는 기록으로 남고 새 메시지는 서버가 거부한다. */
export function isDirectCounterpartWithdrawn(
  conversation: Pick<ConversationSummary, "type" | "participants" | "viewerId">,
): boolean {
  return (
    conversation.type === "direct" &&
    conversation.participants.some(
      ({ id, withdrawn }) => id !== conversation.viewerId && withdrawn === true,
    )
  );
}

/** 이 대화에 새 메시지를 보낼 수 있는지. 입력창, 답장·수정과 게시물 공유 대상이 이 조건을 따른다. */
export function canSendToConversation(
  conversation: Pick<ConversationSummary, "type" | "participants" | "viewerId">,
): boolean {
  return (
    isViewerActive(conversation) && !isDirectCounterpartWithdrawn(conversation)
  );
}
