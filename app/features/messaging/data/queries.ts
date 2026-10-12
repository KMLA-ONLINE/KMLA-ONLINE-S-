import type {
  Conversation,
  ConversationMessage,
  ConversationSummary,
  MessageCursor,
  MessagePage,
  MessageParticipant,
  MessageReaction,
  MessageAttachment,
  MessageAttachmentKind,
  MessageRecipient,
  MessageSystemEvent,
} from "~/features/messaging/model/types";
import { createProfileMediaUrls } from "~/features/profiles/data/media";
import type { Database } from "~/shared/supabase/database.types";
import { getSupabase } from "~/shared/supabase/client";

export const MESSAGE_PAGE_SIZE = 50;
/** `list_messages`가 한 번에 돌려주는 최대 행 수(101)에서 남았는지 확인할 한 개를 뺀 값. */
const MAX_MESSAGE_PAGE_SIZE = 100;

type Functions = Database["public"]["Functions"];
type ConversationRow = Functions["list_conversations"]["Returns"][number];
type MessageRow = Functions["list_messages"]["Returns"][number];

interface ParticipantRow {
  id: number;
  name: string;
  avatar_path: string | null;
  active: boolean;
}

const SYSTEM_KINDS = new Set<MessageSystemEvent["kind"]>([
  "member_added",
  "member_left",
  "member_removed",
  "renamed",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listConversations(): Promise<ConversationSummary[]> {
  const { data, error } = await getSupabase().rpc("list_conversations");
  if (error) throw error;
  return toSummaries(data ?? []);
}

/**
 * 대화 정보, 최신 메시지 한 페이지와 고정 메시지 전체. 대화방 첫 화면은 이 요청들을 함께
 * 기다린다. 내 대화가 아니면 `null`이다.
 */
export async function loadConversation(
  conversationId: string,
  limit = MESSAGE_PAGE_SIZE,
): Promise<Conversation | null> {
  // 주소창에 아무 문자열이나 들어올 수 있다. uuid가 아니면 RPC가 형 변환 오류를 내므로 미리 거른다.
  if (!UUID_PATTERN.test(conversationId)) return null;

  const [summary, page, pinnedMessages] = await Promise.all([
    getConversationSummary(conversationId),
    listMessages(conversationId, null, limit),
    listPinnedMessages(conversationId),
  ]);
  if (!summary) return null;

  return {
    ...summary,
    ...page,
    pinnedMessages,
  };
}

export interface MessageSearchResult {
  id: string;
  senderId: string | null;
  /** 본문 앞부분. */
  body: string;
  sentAt: string;
}

interface SearchResponse {
  results: {
    id: string;
    sender_id: number | null;
    body: string;
    sent_at: string;
  }[];
  next_cursor: { sent_at: string; id: string } | null;
}

/**
 * 대화 내 검색. 서버가 최신부터 한 번에 정해진 수만 훑으므로, `nextCursor`가 있으면 더 앞선 메시지에서
 * 이어 찾을 수 있다.
 */
export async function searchMessages(
  conversationId: string,
  query: string,
  before: MessageCursor | null,
): Promise<{
  results: MessageSearchResult[];
  nextCursor: MessageCursor | null;
}> {
  const { data, error } = await getSupabase().rpc("search_messages", {
    p_conversation_id: conversationId,
    p_query: query,
    p_before_sent_at: before?.sentAt,
    p_before_id: before?.id,
  });
  if (error) throw error;
  const response = data as unknown as SearchResponse;
  return {
    results: response.results.map((row) => ({
      id: row.id,
      senderId: toProfileId(row.sender_id),
      body: row.body,
      sentAt: row.sent_at,
    })),
    nextCursor: response.next_cursor
      ? { sentAt: response.next_cursor.sent_at, id: response.next_cursor.id }
      : null,
  };
}

export interface MessageReactor {
  id: string;
  name: string;
  avatarUrl: string | null;
  reaction: MessageReaction["reaction"];
  reactedAt: string;
}

/** 반응한 사람과 반응 시각(기능 명세 §13.8). 반응 종류, 먼저 남긴 순서다. */
export async function listMessageReactors(
  messageId: string,
): Promise<MessageReactor[]> {
  const { data, error } = await getSupabase().rpc("list_message_reactors", {
    p_message_id: messageId,
  });
  if (error) throw error;
  const rows = data ?? [];
  const avatarUrls = await createProfileMediaUrls(
    rows.map((row) => row.avatar_path),
  );
  return rows.map((row) => ({
    id: String(row.profile_id),
    name: row.name,
    avatarUrl: row.avatar_path
      ? (avatarUrls.get(row.avatar_path) ?? null)
      : null,
    reaction: row.reaction,
    reactedAt: row.reacted_at,
  }));
}

/** 메신저 탭 배지의 숫자. 내 대화들의 읽지 않은 메시지 수 합이다. */
export async function getUnreadMessageCount(): Promise<number> {
  const { data, error } = await getSupabase().rpc(
    "get_my_unread_message_count",
  );
  if (error) throw error;
  return data;
}

/** 대화 목록의 한 줄. 내 대화가 아니면 `null`이다. */
export async function getConversationSummary(
  conversationId: string,
): Promise<ConversationSummary | null> {
  const { data, error } = await getSupabase().rpc("list_conversations", {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  return (await toSummaries(data ?? []))[0] ?? null;
}

/**
 * `before`보다 앞선 메시지 한 페이지. `before`가 없으면 최신 페이지다. 한 개를 더 읽어 그보다
 * 앞선 메시지가 남았는지 안다.
 */
export async function listMessages(
  conversationId: string,
  before: MessageCursor | null,
  limit = MESSAGE_PAGE_SIZE,
): Promise<MessagePage> {
  const size = Math.min(limit, MAX_MESSAGE_PAGE_SIZE);
  const { data, error } = await getSupabase().rpc("list_messages", {
    p_conversation_id: conversationId,
    p_before_sent_at: before?.sentAt,
    p_before_id: before?.id,
    p_limit: size + 1,
  });
  if (error) throw error;

  const rows = data ?? [];
  const page = rows.length > size ? rows.slice(rows.length - size) : rows;
  const oldest = page[0];

  return {
    messages: page.map(toMessage),
    olderCursor:
      rows.length > size && oldest
        ? { sentAt: oldest.sent_at, id: oldest.id }
        : null,
  };
}

/** 대화 순서대로의 고정 메시지 전체. 고정 메시지는 불러온 페이지 밖에 있을 수 있다. */
export async function listPinnedMessages(
  conversationId: string,
): Promise<ConversationMessage[]> {
  const { data, error } = await getSupabase().rpc("list_pinned_messages", {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  return (data ?? []).map(toMessage);
}

/** 따라잡기 한 번에 받는 최대 행 수. 다 차면 더 남았을 수 있다. */
export const MESSAGE_CHANGES_LIMIT = 100;

/**
 * `since` 이후에 바뀐 메시지(새 메시지 포함). 서버가 10초를 겹쳐 읽으므로 이미 가진 행이 섞인다.
 * `complete`가 false면 한도까지 찼으므로 최신 페이지부터 다시 읽어야 한다.
 */
export async function listMessageChanges(
  conversationId: string,
  since: string,
): Promise<{ messages: ConversationMessage[]; complete: boolean }> {
  const { data, error } = await getSupabase().rpc("list_message_changes", {
    p_conversation_id: conversationId,
    p_since: since,
    p_limit: MESSAGE_CHANGES_LIMIT,
  });
  if (error) throw error;
  const rows = data ?? [];
  return {
    messages: rows.map(toMessage),
    complete: rows.length < MESSAGE_CHANGES_LIMIT,
  };
}

/** 내 메시지들의 "읽지 않은 수"만. 본문을 다시 복호화하지 않는다. */
export async function listMessageReadCounts(
  conversationId: string,
  messageIds: string[],
): Promise<Map<string, number>> {
  if (messageIds.length === 0) return new Map();
  const { data, error } = await getSupabase().rpc("list_message_read_counts", {
    p_conversation_id: conversationId,
    p_message_ids: messageIds,
  });
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.id, row.unread_member_count]));
}

/** 서버의 반응 집계(`[{reaction, count}]`, 많은 순서). */
export function toReactions(value: unknown): MessageReaction[] {
  return Array.isArray(value) ? (value as MessageReaction[]) : [];
}

async function toSummaries(
  rows: ConversationRow[],
): Promise<ConversationSummary[]> {
  const participantRows = rows.map((row) =>
    parseParticipants(row.participants),
  );
  const avatarUrls = await createProfileMediaUrls(
    participantRows.flat().map((participant) => participant.avatar_path),
  );

  return rows.map((row, index) => ({
    id: row.conversation_id,
    type: row.type,
    name: row.name,
    viewerId: String(row.viewer_id),
    participants: (participantRows[index] ?? []).map(
      (participant): MessageParticipant => ({
        id: String(participant.id),
        name: participant.name,
        avatarUrl: participant.avatar_path
          ? (avatarUrls.get(participant.avatar_path) ?? null)
          : null,
        active: participant.active,
      }),
    ),
    lastMessage: row.last_message_id
      ? {
          senderId: toProfileId(row.last_message_sender_id),
          body: row.last_message_deleted
            ? "삭제된 메시지입니다"
            : (row.last_message_body ?? ""),
          sentAt: row.last_message_sent_at,
          attachmentKind:
            (row.last_message_attachment_kind as MessageAttachmentKind | null) ??
            null,
        }
      : null,
    unreadCount: row.unread_count,
    muted: row.muted,
    canManageMembers: row.can_manage_members,
  }));
}

function parseParticipants(value: unknown): ParticipantRow[] {
  return Array.isArray(value) ? (value as ParticipantRow[]) : [];
}

function toMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    senderId: toProfileId(row.sender_id),
    body: row.body,
    sentAt: row.sent_at,
    editedAt: row.edited_at,
    deleted: row.deleted,
    replyTo: row.reply_to_id
      ? {
          id: row.reply_to_id,
          senderId: toProfileId(row.reply_sender_id),
          body: row.reply_body ?? "",
          deleted: row.reply_deleted,
        }
      : undefined,
    unreadMemberCount: row.unread_member_count ?? undefined,
    reactions: toReactions(row.reactions),
    myReaction: row.my_reaction,
    pinned: row.pinned,
    changedAt: row.changed_at,
    system: toSystemEvent(row),
    attachments: toAttachments(row.attachments),
  };
}

interface AttachmentRow {
  id: string;
  kind: MessageAttachmentKind;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  object_path: string;
  thumbnail_path: string | null;
  file_name: string;
}

export function toAttachments(value: unknown): MessageAttachment[] {
  if (!Array.isArray(value)) return [];
  return (value as AttachmentRow[]).map((row) => ({
    id: row.id,
    kind: row.kind,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    fileName: row.file_name,
    objectPath: row.object_path,
    thumbnailPath: row.thumbnail_path,
  }));
}

function toSystemEvent(row: MessageRow): MessageSystemEvent | undefined {
  const kind = row.system_kind as MessageSystemEvent["kind"] | null;
  if (!kind || !SYSTEM_KINDS.has(kind)) return undefined;
  return {
    kind,
    profileIds: (row.system_profile_ids ?? []).map(String),
    name: row.system_name,
  };
}

const PROFILE_TYPE_LABELS = {
  student: "학생",
  alumni: "졸업생",
  teacher: "선생님",
} as const;

/** 대화 상대 찾기. 공백과 대소문자를 무시하고, 나는 빠진다. */
export async function searchMessageRecipients(
  query: string,
): Promise<MessageRecipient[]> {
  if (!query.trim()) return [];
  const { data, error } = await getSupabase().rpc("search_message_recipients", {
    p_query: query,
  });
  if (error) throw error;
  const rows = data ?? [];
  const avatarUrls = await createProfileMediaUrls(
    rows.map((row) => row.avatar_path),
  );
  return rows.map((row) => ({
    id: String(row.profile_id),
    name: row.name,
    avatarUrl: row.avatar_path
      ? (avatarUrls.get(row.avatar_path) ?? null)
      : null,
    description:
      row.profile_type === "teacher"
        ? PROFILE_TYPE_LABELS.teacher
        : `${row.cohort}기 ${PROFILE_TYPE_LABELS[row.profile_type]}`,
  }));
}

/** 프로필 ID는 화면에서 문자열로 다룬다. 탈퇴로 지워진 발신자는 `null`이다. */
function toProfileId(value: number | null): string | null {
  return value === null ? null : String(value);
}

export interface SharedAttachment extends MessageAttachment {
  messageId: string;
  senderId: string | null;
  sentAt: string;
}

/** 대화에서 공유된 미디어(사진·동영상) 또는 파일. 최근 것부터 한 쪽씩 준다. */
export async function listSharedAttachments(
  conversationId: string,
  media: boolean,
  before: MessageCursor | null,
  limit = 30,
): Promise<{ items: SharedAttachment[]; nextCursor: MessageCursor | null }> {
  const { data, error } = await getSupabase().rpc(
    "list_conversation_attachments",
    {
      p_conversation_id: conversationId,
      p_media: media,
      p_before_sent_at: before?.sentAt,
      p_before_id: before?.id,
      p_limit: limit + 1,
    },
  );
  if (error) throw error;
  const rows = data ?? [];
  const page = rows.slice(0, limit);
  const items = toAttachments(page).map((attachment, index) => {
    const row = page[index];
    return {
      ...attachment,
      messageId: row.message_id,
      senderId: row.sender_id === null ? null : String(row.sender_id),
      sentAt: row.sent_at,
    };
  });
  const last = page.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? { sentAt: last.sent_at, id: last.id }
        : null,
  };
}

export async function getSharedAttachmentCounts(
  conversationId: string,
): Promise<{ media: number; files: number }> {
  const { data, error } = await getSupabase().rpc(
    "get_conversation_attachment_counts",
    { p_conversation_id: conversationId },
  );
  if (error) throw error;
  const row = data?.[0];
  return { media: row?.media_count ?? 0, files: row?.file_count ?? 0 };
}
