import { describe, expect, it } from "vitest";

import {
  CONVERSATION_LIST_TABS,
  filterConversationList,
} from "~/features/messaging/model/conversation-filter";
import type { ConversationSummary } from "~/features/messaging/model/types";

function summary(
  overrides: Partial<ConversationSummary> & Pick<ConversationSummary, "id">,
): ConversationSummary {
  return {
    type: "direct",
    name: overrides.id,
    viewerId: "viewer",
    participants: [],
    lastMessage: null,
    unreadCount: 0,
    notificationLevel: "all",
    canDelete: false,
    hidden: false,
    pinned: false,
    imageUrl: null,
    ...overrides,
  };
}

const conversations = [
  summary({
    id: "council",
    name: "학생회 기획부",
    type: "group",
    unreadCount: 3,
  }),
  summary({ id: "hyunwoo", name: "이현우" }),
  summary({ id: "club", name: "영화 동아리", type: "group" }),
  summary({ id: "seo", name: "박서현", unreadCount: 1 }),
];

describe("filterConversationList", () => {
  it("lists the three tabs in order: all, unread, group", () => {
    expect(CONVERSATION_LIST_TABS.map(({ id }) => id)).toEqual([
      "all",
      "unread",
      "group",
    ]);
  });

  it("keeps every conversation on the all tab and the list order", () => {
    expect(
      filterConversationList(conversations, { tab: "all", query: "" }).map(
        ({ id }) => id,
      ),
    ).toEqual(["council", "hyunwoo", "club", "seo"]);
  });

  it("keeps only conversations with unread messages on the unread tab", () => {
    expect(
      filterConversationList(conversations, { tab: "unread", query: "" }).map(
        ({ id }) => id,
      ),
    ).toEqual(["council", "seo"]);
  });

  it("keeps only group conversations on the group tab", () => {
    expect(
      filterConversationList(conversations, { tab: "group", query: "" }).map(
        ({ id }) => id,
      ),
    ).toEqual(["council", "club"]);
  });

  it("matches the name case-insensitively and combines with the tab", () => {
    expect(
      filterConversationList(conversations, {
        tab: "group",
        query: "  동아리 ",
      }).map(({ id }) => id),
    ).toEqual(["club"]);
    expect(
      filterConversationList(
        [summary({ id: "en", name: "Film Club", type: "group" })],
        { tab: "all", query: "film" },
      ).map(({ id }) => id),
    ).toEqual(["en"]);
  });
});
