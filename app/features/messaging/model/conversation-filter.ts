import type { ConversationSummary } from "~/features/messaging/model/types";

/** 대화 목록 위의 구분 탭(기능 명세 §13.2). */
export type ConversationListTab = "all" | "unread" | "group";

const TAB_TEXT: Record<
  ConversationListTab,
  {
    label: string;
    /** 탭에 맞는 대화가 하나도 없을 때의 안내. */
    empty: string;
  }
> = {
  all: { label: "전체", empty: "아직 채팅이 없습니다" },
  unread: { label: "안 읽음", empty: "읽지 않은 채팅이 없습니다" },
  group: { label: "그룹", empty: "그룹 채팅이 없습니다" },
};

export const CONVERSATION_LIST_TABS = (["all", "unread", "group"] as const).map(
  (id) => ({ id, ...TAB_TEXT[id] }),
);

export function conversationListEmptyLabel(tab: ConversationListTab): string {
  return TAB_TEXT[tab].empty;
}

function matchesTab(
  conversation: ConversationSummary,
  tab: ConversationListTab,
  openRoomId: string | undefined,
): boolean {
  switch (tab) {
    case "all":
      return true;
    case "unread":
      // 연 대화는 읽음 처리돼도 남겨, 넓은 화면에서 보고 있는 행이 목록에서 사라지지 않게 한다.
      return conversation.unreadCount > 0 || conversation.id === openRoomId;
    case "group":
      return conversation.type === "group";
  }
}

/**
 * 대화 목록을 구분 탭과 이름 검색으로 거른다. 순서는 그대로 두며, 검색은 앞뒤 공백을 버리고 대소문자를
 * 가리지 않는다.
 */
export function filterConversationList(
  conversations: readonly ConversationSummary[],
  {
    tab,
    query,
    openRoomId,
  }: { tab: ConversationListTab; query: string; openRoomId?: string },
): readonly ConversationSummary[] {
  const needle = query.trim().toLocaleLowerCase("ko");
  if (tab === "all" && needle === "") return conversations;
  return conversations.filter(
    (conversation) =>
      matchesTab(conversation, tab, openRoomId) &&
      (needle === "" ||
        conversation.name.toLocaleLowerCase("ko").includes(needle)),
  );
}
