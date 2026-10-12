import type {
  Conversation,
  ConversationMessage,
  ConversationSummary,
  MessageCursor,
  MessagePage,
  MessageParticipant,
  MessageReaction,
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
}

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
    // 첨부는 아직 저장하지 않는다(기술 설계 §3의 다음 단계).
    sharedMediaCount: 0,
    sharedFileCount: 0,
    sharedLinkCount: 0,
  };
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
      }),
    ),
    lastMessage: row.last_message_id
      ? {
          senderId: toProfileId(row.last_message_sender_id),
          body: row.last_message_deleted
            ? "삭제된 메시지입니다"
            : (row.last_message_body ?? ""),
          sentAt: row.last_message_sent_at,
        }
      : null,
    unreadCount: row.unread_count,
    muted: row.muted,
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
  };
}

/** 프로필 ID는 화면에서 문자열로 다룬다. 탈퇴로 지워진 발신자는 `null`이다. */
function toProfileId(value: number | null): string | null {
  return value === null ? null : String(value);
}
