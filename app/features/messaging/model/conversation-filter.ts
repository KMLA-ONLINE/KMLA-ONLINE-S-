import type { ConversationSummary } from "~/features/messaging/model/types";

/** 대화 목록 위의 구분 탭(기능 명세 §13.2). */
export type ConversationListTab = "all" | "unread" | "group";

export const CONVERSATION_LIST_TABS: readonly {
  id: ConversationListTab;
  label: string;
  /** 탭에 맞는 대화가 하나도 없을 때의 안내. */
  empty: string;
}[] = [
  { id: "all", label: "전체", empty: "아직 채팅이 없습니다" },
  { id: "unread", label: "안 읽음", empty: "읽지 않은 채팅이 없습니다" },
  { id: "group", label: "그룹", empty: "그룹 채팅이 없습니다" },
];

function matchesTab(
  conversation: ConversationSummary,
  tab: ConversationListTab,
): boolean {
  switch (tab) {
    case "all":
      return true;
    case "unread":
      return conversation.unreadCount > 0;
    case "group":
      return conversation.type === "group";
  }
}

/**
 * 대화 목록을 구분 탭과 이름 검색으로 거른다. 순서는 그대로 두며, 검색은 앞뒤 공백을 버리고 대소문자를
 * 가리지 않는다. 메신저 목록과 메시지 독이 같이 쓴다.
 */
export function filterConversationList(
  conversations: readonly ConversationSummary[],
  { tab, query }: { tab: ConversationListTab; query: string },
): ConversationSummary[] {
  const needle = query.trim().toLocaleLowerCase("ko");
  return conversations.filter(
    (conversation) =>
      matchesTab(conversation, tab) &&
      (needle === "" ||
        conversation.name.toLocaleLowerCase("ko").includes(needle)),
  );
}
