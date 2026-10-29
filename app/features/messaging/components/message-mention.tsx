import { createContext, use, useMemo, type ReactNode } from "react";
import { Link } from "react-router";

import { resolveMessageMention } from "~/features/messaging/model/message-mentions";
import type {
  ConversationMessage,
  MessageParticipant,
} from "~/features/messaging/model/types";
import { cn } from "~/shared/lib/utils";

const ParticipantsContext = createContext<
  ReadonlyMap<string, MessageParticipant>
>(new Map());

/**
 * 멘션의 프로필을 찾을 대화 참여자. 메시지 행은 memo로 감싸 넘기는 값을 원시값과 고정 참조로 제한하므로(`ThreadMessage`),
 * 참여자 표는 props 대신 대화방 전체에 한 번 내려 준다. 나간 멤버도 들어 있어 그 사람을 부른 멘션도 프로필로 잇는다.
 */
export function MessageParticipantsProvider({
  participants,
  children,
}: {
  participants: MessageParticipant[];
  children: ReactNode;
}) {
  const byId = useMemo(
    () =>
      new Map(participants.map((participant) => [participant.id, participant])),
    [participants],
  );
  return <ParticipantsContext value={byId}>{children}</ParticipantsContext>;
}

/**
 * 보낸 메시지의 멘션 한 자리. 이름은 토큰에 적힌 글자이고, 참여자 목록에서는 프로필만 찾는다. 대상을 모르면 평범한 글자로
 * 그린다. 상대 메시지는 강조색, 내 메시지는 primary 버블 위라 버블 글자색으로 굵게만 그린다.
 */
export function MessageMention({
  ordinal,
  label,
  message,
  onPrimary,
}: {
  ordinal: number;
  /** 토큰에 적힌, 보낼 때 보이던 이름. */
  label: string;
  message: Pick<ConversationMessage, "mentionProfileIds" | "mentionsEveryone">;
  onPrimary: boolean;
}) {
  const mention = resolveMessageMention(
    ordinal,
    label,
    message,
    use(ParticipantsContext),
  );
  if (!mention) return <>@{label}</>;

  const className = cn(
    "font-semibold",
    onPrimary ? "text-action-foreground" : "text-primary",
  );
  if (!mention.pubId) return <span className={className}>@{mention.name}</span>;
  return (
    <Link
      to={`/profile/${mention.pubId}`}
      className={cn(className, "hover:underline")}
    >
      @{mention.name}
    </Link>
  );
}
