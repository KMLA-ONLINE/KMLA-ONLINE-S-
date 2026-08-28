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

export interface ConversationMessage {
  id: string;
  senderId: string | null;
  body: string;
  sentAt: string;
  dayLabel?: string;
  reactions?: MessageReaction[];
  readBy?: string[];
  pinned?: boolean;
  system?: boolean;
}

export interface ConversationSummary {
  id: string;
  type: "direct" | "group";
  name: string;
  participants: MessageParticipant[];
  lastMessage: string;
  lastActivityLabel: string;
  unreadCount: number;
  muted: boolean;
}

export interface Conversation extends ConversationSummary {
  messages: ConversationMessage[];
  sharedMediaCount: number;
  sharedFileCount: number;
  sharedLinkCount: number;
}
