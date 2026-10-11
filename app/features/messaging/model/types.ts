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
  /** 고친 시각. 고친 적이 없으면 비어 있다. */
  editedAt?: string | null;
  /** 답장 원문. 원문이 아직 불러오지 않은 페이지에 있어도 인용을 그릴 수 있게 서버가 함께 준다. */
  replyTo?: MessageReplyPreview;
  deleted?: boolean;
  /** 내 반응을 포함한 반응 종류별 총수. */
  reactions?: MessageReaction[];
  myReaction?: PostReaction | null;
  /** 내 메시지에서만 의미가 있다. 이 메시지를 아직 읽지 않은 다른 멤버 수. */
  unreadMemberCount?: number;
  pinned?: boolean;
  system?: boolean;
  /** 보냈지만 서버가 아직 확정하지 않은 내 메시지. 확정 전에는 서버에 없어 다른 작업을 받지 않는다. */
  pending?: boolean;
}

export interface MessageReplyPreview {
  id: string;
  senderId: string | null;
  /** 원문이 삭제됐으면 서버가 비워 준다. */
  body: string;
  deleted?: boolean;
}

/** 메시지 목록의 페이지 경계. `(sentAt, id)` 순서로 이보다 앞선 메시지를 읽는다. */
export interface MessageCursor {
  sentAt: string;
  id: string;
}

/** 메시지 한 페이지. 오래된 것부터 정렬하며, 더 앞선 메시지가 있으면 `olderCursor`를 준다. */
export interface MessagePage {
  messages: ConversationMessage[];
  olderCursor: MessageCursor | null;
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

/**
 * 대화방을 열 때 한 번에 받는 값. 대화 정보와 최신 메시지 한 페이지를 함께 받아 첫 화면에
 * 요청이 하나만 들도록 한다. 더 앞선 메시지는 `listMessages`가 `olderCursor`부터 읽는다.
 */
export interface Conversation extends ConversationSummary, MessagePage {
  /** 대화 순서대로의 고정 메시지 전체. 고정 메시지는 불러온 페이지 밖에 있을 수 있다. */
  pinnedMessages: ConversationMessage[];
  sharedMediaCount: number;
  sharedFileCount: number;
  sharedLinkCount: number;
}
