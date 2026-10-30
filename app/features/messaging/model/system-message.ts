import type {
  ConversationSummary,
  MessageParticipant,
  MessageSystemEvent,
} from "~/features/messaging/model/types";

const UNKNOWN_NAME = "알 수 없는 사용자";

/**
 * 대화 안의 시스템 메시지 문구. 이름은 지금과 예전 멤버 모두에서 찾는다. 별명 변경은 별명이 아니라 프로필 이름으로 쓴다 —
 * 별명으로 쓰면 무엇이 무엇으로 바뀌었는지 알 수 없다(기능 명세 §13.25).
 */
export function formatSystemMessage(
  event: MessageSystemEvent,
  participants: ReadonlyMap<string, MessageParticipant>,
): string {
  const byProfileName =
    event.kind === "nickname_set" || event.kind === "nickname_cleared";
  const nameOf = (id: string | undefined) => {
    const participant = id ? participants.get(id) : undefined;
    return (
      (byProfileName
        ? (participant?.profileName ?? participant?.name)
        : participant?.name) ?? UNKNOWN_NAME
    );
  };
  const [actorId, ...targetIds] = event.profileIds;
  const actor = nameOf(actorId);
  const targets = targetIds.map((id) => `${nameOf(id)}님`).join(", ");
  const nicknameOwner =
    targetIds[0] === actorId ? "자신" : `${nameOf(targetIds[0])}님`;

  switch (event.kind) {
    case "member_added":
      return `${actor}님이 ${targets}을 초대했습니다.`;
    case "member_left":
      return `${actor}님이 나갔습니다.`;
    case "member_removed":
      return `${actor}님이 ${targets}을 내보냈습니다.`;
    case "renamed":
      return `${actor}님이 채팅 이름을 ‘${event.name ?? ""}’(으)로 변경했습니다.`;
    case "nickname_set":
      return `${actor}님이 ${nicknameOwner}의 별명을 ‘${event.name ?? ""}’(으)로 정했습니다.`;
    case "nickname_cleared":
      return `${actor}님이 ${nicknameOwner}의 별명을 지웠습니다.`;
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
/** 1:1 대화의 상대. */
export function directCounterpart<P extends { id: string }>(conversation: {
  participants: P[];
  viewerId: string;
}): P | undefined {
  return conversation.participants.find(
    ({ id }) => id !== conversation.viewerId,
  );
}

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
