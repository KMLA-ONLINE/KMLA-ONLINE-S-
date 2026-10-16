import type {
  ConversationSummary,
  MessageParticipant,
  MessageSystemEvent,
} from "~/features/messaging/model/types";

const UNKNOWN_NAME = "알 수 없는 사용자";

/** 대화 안의 시스템 메시지 문구. 이름은 지금과 예전 멤버 모두에서 찾는다. */
export function formatSystemMessage(
  event: MessageSystemEvent,
  participants: Map<string, MessageParticipant>,
): string {
  const nameOf = (id: string | undefined) =>
    (id ? participants.get(id)?.name : undefined) ?? UNKNOWN_NAME;
  const [actorId, ...targetIds] = event.profileIds;
  const actor = nameOf(actorId);
  const targets = targetIds.map((id) => `${nameOf(id)}님`).join(", ");

  switch (event.kind) {
    case "member_added":
      return `${actor}님이 ${targets}을 초대했습니다.`;
    case "member_left":
      return `${actor}님이 나갔습니다.`;
    case "member_removed":
      return `${actor}님이 ${targets}을 내보냈습니다.`;
    case "renamed":
      return `${actor}님이 채팅 이름을 ‘${event.name ?? ""}’(으)로 변경했습니다.`;
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
