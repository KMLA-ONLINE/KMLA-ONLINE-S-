import type { PostReaction } from "~/features/posts/model/types";

export interface MessageParticipant {
  id: string;
  /** 프로필 주소(`/profile/:pubId`). 모르면 프로필로 잇지 않는다. */
  pubId?: string;
  name: string;
  avatarUrl: string | null;
  /** 지금 멤버인지. 나간 사람도 지난 메시지와 시스템 메시지의 이름을 그리려고 목록에 남는다. */
  active: boolean;
}

/** 메시지 첨부 종류. 동영상은 지원하지 않는다(기능 명세 §13.5). */
export type MessageAttachmentKind = "image" | "audio" | "file";

/** 메시지 첨부 한 개. object는 비공개 버킷에 있고 화면은 signed URL로 연다. */
export interface MessageAttachment {
  id: string;
  kind: MessageAttachmentKind;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  fileName: string;
  objectPath: string;
  /** 사진의 목록용 축소본. 없으면 원본을 그린다. */
  thumbnailPath: string | null;
  /** 보내는 중에 그릴 기기 안의 미리보기 URL. 서버에서 받은 첨부에는 없다. */
  previewUrl?: string;
}

/** 멤버 추가·나가기·내보내기·이름 변경을 대화 안에 남긴 시스템 메시지(기능 명세 §13.17). */
export interface MessageSystemEvent {
  kind: "member_added" | "member_left" | "member_removed" | "renamed";
  /** 첫 번째가 한 사람(초대한 사람, 나간 사람, 내보낸 사람, 이름을 바꾼 사람), 나머지가 대상이다. */
  profileIds: string[];
  /** 바꾼 그룹 이름. `renamed`에만 있다. */
  name: string | null;
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
  /** 이 메시지를 아직 읽지 않은 다른 멤버 수. 보낸 사람과 나는 세지 않는다. */
  unreadMemberCount?: number;
  pinned?: boolean;
  /** 첨부. 본문 없이 첨부만 있는 메시지도 있다. */
  attachments?: MessageAttachment[];
  /** 시스템 메시지면 채운다. 본문은 비어 있고 화면 문구는 `formatSystemMessage`가 만든다. */
  system?: MessageSystemEvent;
  /** 서버에서 이 메시지의 무엇이든 마지막으로 바뀐 시각. 따라잡기의 기준으로만 쓴다. */
  changedAt?: string;
  /** 보내지 못한 내 메시지. 목록에 남겨 같은 ID로 다시 보내거나 지울 수 있게 한다. */
  failed?: boolean;
  /** 보냈지만 서버가 아직 확정하지 않은 내 메시지. 확정 전에는 서버에 없어 다른 작업을 받지 않는다. */
  pending?: boolean;
}

export interface MessageReplyPreview {
  id: string;
  senderId: string | null;
  /** 원문이 삭제됐으면 서버가 비워 준다. */
  body: string;
  deleted?: boolean;
  /** 원문의 첫 첨부 종류. 본문 없이 첨부만 있는 원문을 "사진"처럼 부를 때 쓴다. */
  attachmentKind?: MessageAttachmentKind | null;
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
  /** 첫 첨부의 종류. 본문 없이 첨부만 있는 메시지를 "사진"처럼 부를 때 쓴다. */
  attachmentKind?: MessageAttachmentKind | null;
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
  /** 그룹에서 다른 멤버를 내보낼 수 있는지. 만든 사람과 앱 관리자다. */
  /** 그룹을 지울 수 있는지. 소유주와 앱 관리자다. */
  canDelete: boolean;
}

/** 대화 상대 찾기 결과 한 사람. */
export interface MessageRecipient {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** "29기 학생", "선생님"처럼 같은 이름을 가를 설명. */
  description: string;
}

/**
 * 대화방을 열 때 한 번에 받는 값. 대화 정보와 최신 메시지 한 페이지를 함께 받아 첫 화면에
 * 요청이 하나만 들도록 한다. 더 앞선 메시지는 `listMessages`가 `olderCursor`부터 읽는다.
 */
export interface Conversation extends ConversationSummary, MessagePage {
  /** 대화 순서대로의 고정 메시지 전체. 고정 메시지는 불러온 페이지 밖에 있을 수 있다. */
  pinnedMessages: ConversationMessage[];
}
