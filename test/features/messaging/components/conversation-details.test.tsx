import { describe, expect, it, vi } from "vitest";

import { ConversationDetails } from "~/features/messaging/components/conversation-details";
import type { Conversation } from "~/features/messaging/model/types";
import { renderRoute, screen } from "../../../router";

const conversation: Conversation = {
  id: "room",
  type: "group",
  name: "동아리",
  viewerId: "me",
  participants: [
    { id: "me", name: "나", avatarUrl: null, active: true },
    {
      id: "peer",
      name: "감자",
      profileName: "김민준",
      nickname: "감자",
      avatarUrl: null,
      active: true,
    },
  ],
  lastMessage: null,
  unreadCount: 0,
  notificationLevel: "all",
  canDelete: false,
  hidden: false,
  messages: [],
  olderCursor: null,
  pinnedMessages: [],
};

describe("ConversationDetails", () => {
  it("멤버 목록에는 별명 대신 본명만 표시한다", () => {
    renderRoute(() => (
      <ConversationDetails
        conversation={conversation}
        className="flex"
        onMobileBack={vi.fn()}
        pinnedCount={0}
        onOpenPinnedMessages={vi.fn()}
        notificationLevel="all"
        onNotificationLevelChange={vi.fn()}
        onSearch={vi.fn()}
        onInvite={vi.fn()}
        onRename={vi.fn()}
        onNicknames={vi.fn()}
        onLeave={vi.fn()}
        onDeleteGroup={vi.fn()}
        sharedCounts={undefined}
        onOpenSharedMedia={vi.fn()}
      />
    ));

    expect(screen.getByText("김민준", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("감자", { exact: true })).not.toBeInTheDocument();
  });
});
