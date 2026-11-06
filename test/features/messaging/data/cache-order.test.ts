import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  messagingKeys,
  replaceConversationSummary,
} from "~/features/messaging/data/cache";
import type { ConversationSummary } from "~/features/messaging/model/types";

function summary(
  id: string,
  sentAt: string | null,
  pinned = false,
): ConversationSummary {
  return {
    id,
    type: "direct",
    name: id,
    viewerId: "viewer",
    participants: [],
    lastMessage: sentAt
      ? { senderId: "other", body: "hi", sentAt, attachmentKind: null }
      : null,
    unreadCount: 0,
    notificationLevel: "all",
    canDelete: false,
    hidden: false,
    pinned,
    imageUrl: null,
  };
}

describe("conversation list order in the cache", () => {
  it("keeps pinned conversations above the rest, each group by last message", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<ConversationSummary[]>(
      messagingKeys.conversations(),
      [
        summary("newest", "2026-11-07T10:00:00Z"),
        summary("older", "2026-11-07T09:00:00Z"),
        summary("oldest", "2026-11-07T08:00:00Z"),
        summary("silent", null),
      ],
    );

    replaceConversationSummary(
      queryClient,
      summary("oldest", "2026-11-07T08:00:00Z", true),
    );
    replaceConversationSummary(
      queryClient,
      summary("older", "2026-11-07T09:00:00Z", true),
    );

    expect(
      queryClient
        .getQueryData<ConversationSummary[]>(messagingKeys.conversations())
        ?.map(({ id }) => id),
    ).toEqual(["older", "oldest", "newest", "silent"]);
  });
});
