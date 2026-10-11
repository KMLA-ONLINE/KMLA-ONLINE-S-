import type { PostReaction } from "~/features/posts/model/types";

export interface MessageParticipant {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface MessageReaction {
  reaction: PostReaction;
  count: number;
}

/**
 * 서버가 주는 메시지 한 건. 시각은 ISO 문자열이고, "오후 3:12"나 날짜 구분선 같은 화면 문구는
 * `model/message-time.ts`가 만든다.
 */
export interface ConversationMessage {
  id: string;
  senderId: string | null;
  body: string;
  sentAt: string;
  replyToMessageId?: string;
  deleted?: boolean;
  reactions?: MessageReaction[];
  /** 내 메시지에서만 의미가 있다. 이 메시지를 아직 읽지 않은 다른 멤버 수. */
  unreadMemberCount?: number;
  pinned?: boolean;
  system?: boolean;
}

export interface MessagePreview {
  senderId: string | null;
  body: string;
  sentAt: string;
}

export interface ConversationSummary {
  id: string;
  type: "direct" | "group";
  name: string;
  /** 이 대화에서 나를 가리키는 참여자 ID. 서버가 호출자 기준으로 채운다. */
  viewerId: string;
  participants: MessageParticipant[];
  lastMessage: MessagePreview | null;
  unreadCount: number;
  muted: boolean;
}

export interface Conversation extends ConversationSummary {
  messages: ConversationMessage[];
  sharedMediaCount: number;
  sharedFileCount: number;
  sharedLinkCount: number;
}
